import { Alert, Button, Empty, Spin, Typography } from 'antd';
import { Box } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  TwinBlockedReason,
  TwinSceneSnapshot,
} from '../../server/twin-types.js';
import { usePreferences } from '../i18n';
import {
  type TwinStage,
  type TwinViewPreset,
  mountTwinStage,
} from '../twin/engine';
import {
  createScreenCanvases,
  useScreenTextures,
} from '../twin/useScreenTextures';
import { useTwinTelemetry } from '../twin/useTwinTelemetry';
import './TwinPanel.less';

export type { TwinViewPreset };

const REASON_TEXT: Record<TwinBlockedReason, [string, string]> = {
  'arm-disconnected': ['机械臂未连接', 'Robot is not connected'],
  'visual-model-missing': [
    '当前机械臂没有 3D 模型',
    'No 3D model for this arm',
  ],
  'camera-not-running': ['相机未运行', 'Camera is not running'],
  'calibration-required': [
    '缺少可用的屏幕标定',
    'No usable screen calibration',
  ],
  'screen-mapping-required': [
    '缺少屏幕像素映射',
    'Screen pixel mapping is missing',
  ],
  'perspective-required': [
    '缺少已应用的透视校正',
    'No applied perspective correction',
  ],
};

function sceneKey(scene: TwinSceneSnapshot) {
  return [
    scene.robot?.visual.id ?? '',
    ...scene.screens.map((screen) =>
      [
        screen.id,
        screen.calibrationId,
        screen.physicalWidthMm.toFixed(2),
        screen.physicalHeightMm.toFixed(2),
        screen.originMm.x.toFixed(2),
        screen.originMm.y.toFixed(2),
        screen.originMm.z.toFixed(2),
      ].join(':'),
    ),
  ].join('|');
}

export function TwinPanel({
  connected,
  viewPreset,
}: {
  connected: boolean;
  viewPreset: TwinViewPreset;
}) {
  const language = usePreferences((state) => state.language);
  const zh = language === 'zh';
  const [scene, setScene] = useState<TwinSceneSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [stageError, setStageError] = useState<string>();
  const [progress, setProgress] = useState<{ loaded: number; total: number }>();
  const [canvases, setCanvases] = useState<Record<string, HTMLCanvasElement>>(
    {},
  );
  const [stageReady, setStageReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<TwinStage | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await fetch('/api/twin/scene', {
        cache: 'no-store',
        signal: AbortSignal.timeout(15_000),
      });
      const data = (await response.json()) as TwinSceneSnapshot & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(data.error ?? `HTTP ${response.status}`);
      setScene(data);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, connected]);

  const key = scene ? sceneKey(scene) : '';
  useEffect(() => {
    if (!scene?.ready || !canvasRef.current) return;
    const container = canvasRef.current.parentElement;
    if (!container) return;
    const nextCanvases = createScreenCanvases(scene.screens);
    setCanvases(nextCanvases);
    setStageReady(false);
    setStageError(undefined);
    let cancelled = false;
    mountTwinStage({
      container,
      canvas: canvasRef.current,
      scene,
      screenCanvases: nextCanvases,
      onProgress: (loaded, total) => {
        if (!cancelled) setProgress({ loaded, total });
      },
    })
      .then((stage) => {
        if (cancelled) {
          stage.dispose();
          return;
        }
        stageRef.current = stage;
        setProgress(undefined);
        setStageReady(true);
      })
      .catch((failure) => {
        if (!cancelled)
          setStageError(
            failure instanceof Error ? failure.message : String(failure),
          );
      });
    return () => {
      cancelled = true;
      stageRef.current?.dispose();
      stageRef.current = null;
    };
    // The scene key is the geometry identity; remounting on every poll would
    // rebuild the WebGL scene and reload the STL model.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const telemetry = useTwinTelemetry(
    useCallback((sample) => {
      stageRef.current?.setJoints(sample.joints);
    }, []),
  );

  // One measured flange pose removes the URDF-vs-controller base offset. Skip
  // while moving: the pose and the joints in that window describe different
  // instants, and the correction would chase the arm.
  useEffect(() => {
    const state = telemetry.state;
    if (!state?.pose || state.moving || !telemetry.hasJoints) return;
    stageRef.current?.alignToPose(state.pose.positionMm, state.pose.quaternion);
  }, [telemetry.state, telemetry.hasJoints]);

  useEffect(() => {
    if (!stageReady) return;
    stageRef.current?.setViewPreset(viewPreset);
  }, [viewPreset, stageReady]);

  useScreenTextures(
    scene?.screens ?? [],
    canvases,
    stageRef,
    Boolean(scene?.ready && stageReady),
  );

  const skipped = scene?.skippedScreens ?? [];
  const reasons = useMemo(() => {
    const seen = new Set<TwinBlockedReason>();
    for (const reason of scene?.blockedReasons ?? []) seen.add(reason);
    for (const screen of skipped) seen.add(screen.reason);
    return [...seen];
  }, [scene, skipped]);

  return (
    <section className="twin-panel" aria-label={zh ? '3D 数字孪生' : '3D twin'}>
      {loading && (
        <div className="twin-placeholder">
          <Spin />
          <span>{zh ? '读取场景…' : 'Loading scene…'}</span>
        </div>
      )}
      {!loading && error && (
        <div className="twin-placeholder">
          <Alert
            type="error"
            showIcon
            message={zh ? '读取 3D 场景失败' : 'Failed to load the scene'}
            description={error}
          />
          <Button onClick={() => void load()}>{zh ? '重试' : 'Retry'}</Button>
        </div>
      )}
      {!loading && !error && scene && !scene.ready && (
        <div className="twin-placeholder">
          <Empty
            image={<Box size={44} strokeWidth={1.2} />}
            description={
              zh
                ? '3D 视图需要先完成屏幕标定与透视校正'
                : 'Finish screen calibration and perspective correction first'
            }
          />
          <ul className="twin-checklist">
            {reasons.map((reason) => (
              <li key={reason}>
                <span aria-hidden="true">•</span>
                {REASON_TEXT[reason][zh ? 0 : 1]}
              </li>
            ))}
          </ul>
          {skipped.length > 0 && (
            <Typography.Text type="secondary">
              {skipped
                .map(
                  (screen) =>
                    `${screen.name}: ${REASON_TEXT[screen.reason][zh ? 0 : 1]}`,
                )
                .join(' · ')}
            </Typography.Text>
          )}
          <Button type="primary" onClick={() => void load()}>
            {zh ? '重新检查' : 'Check again'}
          </Button>
        </div>
      )}
      {!loading && !error && scene?.ready && (
        <div className="twin-stage">
          <canvas ref={canvasRef} />
          {progress && (
            <div className="twin-progress">
              {zh
                ? `加载模型 ${progress.loaded}/${progress.total}`
                : `Loading model ${progress.loaded}/${progress.total}`}
            </div>
          )}
          {stageError && (
            <div className="twin-progress is-error">{stageError}</div>
          )}
        </div>
      )}
    </section>
  );
}
