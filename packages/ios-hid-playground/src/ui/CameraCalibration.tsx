import {
  CalibrationModelVerifier,
  CameraDetectionActions,
} from '@midscene/arm-calibration-ui';
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
        onCancel={onCancel}
        renderDetectionActions={(props) => <DetectionActions {...props} />}
      />
    </CalibrationModelVerifier.Provider>
  );
}
