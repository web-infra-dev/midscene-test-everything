import {
  CalibrationModelVerifier,
  CameraDetectionActions,
} from '@midscene/arm-calibration-ui';
import type { CameraScreenSettings } from '@midscene/robotics-vision';
import { CameraSetup } from '@midscene/robotics-vision/ui/CameraSetup';
import { useState } from 'react';

function DetectionActions({
  markers,
  ai,
  busy,
  markersDisabled,
  aiDisabled,
}: {
  markers: () => Promise<void>;
  ai: (model?: unknown) => Promise<void>;
  busy: boolean;
  markersDisabled: boolean;
  aiDisabled: boolean;
}) {
  const [kind, setKind] = useState<'markers' | 'ai'>('markers');
  return (
    <CameraDetectionActions
      detect={async (next, model) => {
        setKind(next ?? 'markers');
        if (next === 'ai') await ai(model);
        else await markers();
      }}
      detecting={busy}
      detectionKind={kind}
      markersDisabled={markersDisabled}
      aiDisabled={aiDisabled}
      settingsDisabled={busy}
    />
  );
}
export function CameraCalibration({
  baseUrl,
  cameraId,
  onCancel,
}: {
  baseUrl: string;
  cameraId?: string;
  onCancel: () => void;
}) {
  async function confirm(settings: CameraScreenSettings) {
    const response = await fetch(`${baseUrl}/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Midscene-Setup': baseUrl.split('/').filter(Boolean).at(-1)!,
      },
      body: JSON.stringify(settings),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (response.ok) return;
    const result = await response.json();
    const error = String(result.error ?? '校正失败，请重试。');
    if (error.includes('Independent check error'))
      throw new Error(
        '屏幕四角校验未通过。请让四个角点贴合屏幕边缘，或重新识别屏幕标记后再确认。',
      );
    if (error.includes('Cannot reliably locate the mouse pointer'))
      throw new Error(
        '未能确认指针方向。请确认手机已开启辅助触控，画面中能清楚看到指针移动。检查对焦和反光后再次确认。',
      );
    throw new Error(error);
  }

  return (
    <CalibrationModelVerifier.Provider
      value={async (env) => {
        const response = await fetch(`${baseUrl}/verify-model`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Midscene-Setup': baseUrl.split('/').filter(Boolean).at(-1)!,
          },
          body: JSON.stringify(env),
          signal: AbortSignal.timeout(150000),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? '模型验证失败');
        return result;
      }}
    >
      <CameraSetup
        baseUrl={baseUrl}
        selectedCameraId={cameraId}
        fullPage
        continueLabel="确认画面并验证指针"
        savingLabel="正在校正并验证指针…"
        onConfirm={confirm}
        onCancel={onCancel}
        renderDetectionActions={(props) => <DetectionActions {...props} />}
      />
    </CalibrationModelVerifier.Provider>
  );
}
