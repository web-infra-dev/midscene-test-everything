import { Alert, Button, Empty, Spin, Typography } from 'antd';
import { Box } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    setScene(undefined);
    setError(undefined);
    const load = async () => {
      try {
        const response = await fetch('/api/twin/scene', {
          cache: 'no-store',
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15_000),
          ]),
        });
        const data = (await response.json()) as TwinSceneSnapshot & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!controller.signal.aborted) setScene(data);
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      }
    };
    void load();
    return () => controller.abort();
  }, [connected, revision]);

  const retry = () => setRevision((value) => value + 1);
  const skipped = scene?.skippedScreens ?? [];
  const reasons = useMemo(() => {
    const seen = new Set<TwinBlockedReason>();
    for (const reason of scene?.blockedReasons ?? []) seen.add(reason);
    for (const screen of skipped) seen.add(screen.reason);
    return [...seen];
  }, [scene, skipped]);

  return (
    <section className="twin-panel" aria-label={zh ? '3D 数字孪生' : '3D twin'}>
      {!scene && !error && (
        <div className="twin-placeholder">
          <Spin />
          <span>{zh ? '读取场景…' : 'Loading scene…'}</span>
        </div>
      )}
      {error && (
        <div className="twin-placeholder">
          <Alert
            type="error"
            showIcon
            message={zh ? '读取 3D 场景失败' : 'Failed to load the scene'}
            description={error}
          />
          <Button onClick={retry}>{zh ? '重试' : 'Retry'}</Button>
        </div>
      )}
      {scene && !scene.ready && (
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
          <Button type="primary" onClick={retry}>
            {zh ? '重新检查' : 'Check again'}
          </Button>
        </div>
      )}
      {scene?.ready && (
        <TwinViewport scene={scene} viewPreset={viewPreset} zh={zh} />
      )}
    </section>
  );
}

function TwinViewport({
  scene,
  viewPreset,
  zh,
}: { scene: TwinSceneSnapshot; viewPreset: TwinViewPreset; zh: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stage, setStage] = useState<TwinStage>();
  const [stageError, setStageError] = useState<string>();
  const [progress, setProgress] = useState<{ loaded: number; total: number }>();
  const shownStage = useRef<TwinStage>();
  const canvases = useMemo(
    () => createScreenCanvases(scene.screens),
    [scene.screens],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas?.parentElement) return;
    let cancelled = false;
    let mounted: TwinStage | undefined;
    mountTwinStage({
      container: canvas.parentElement,
      canvas,
      scene,
      screenCanvases: canvases,
      onProgress: (loaded, total) => {
        if (!cancelled) setProgress({ loaded, total });
      },
    })
      .then((next) => {
        if (cancelled) return next.dispose();
        mounted = next;
        setProgress(undefined);
        setStage(next);
      })
      .catch((failure) => {
        if (!cancelled) {
          setProgress(undefined);
          setStageError(
            failure instanceof Error ? failure.message : String(failure),
          );
        }
      });
    return () => {
      cancelled = true;
      mounted?.dispose();
    };
  }, [scene, canvases]);

  const ready = useTwinTelemetry(stage);
  useScreenTextures(scene.screens, canvases, stage);
  useLayoutEffect(() => {
    if (!stage || !ready) return;
    const shown = shownStage.current === stage;
    stage.setViewPreset(viewPreset, shown);
    if (!shown) {
      stage.setActive(true);
      shownStage.current = stage;
    }
  }, [viewPreset, stage, ready]);

  return (
    <div className="twin-stage" aria-busy={!ready && !stageError}>
      <canvas
        ref={canvasRef}
        style={{ visibility: ready ? 'visible' : 'hidden' }}
      />
      {!ready && !stageError && (
        <div className="twin-progress">
          {progress
            ? zh
              ? `加载模型 ${progress.loaded}/${progress.total}`
              : `Loading model ${progress.loaded}/${progress.total}`
            : stage
              ? zh
                ? '正在对齐机械臂姿态…'
                : 'Aligning the arm pose…'
              : zh
                ? '加载模型…'
                : 'Loading model…'}
        </div>
      )}
      {stageError && <div className="twin-progress is-error">{stageError}</div>}
    </div>
  );
}
