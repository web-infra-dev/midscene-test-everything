import { Button } from 'antd';
import { useState } from 'react';
import { t, useCalibrationLanguage } from '../i18n';
import {
  type CalibrationModelConfig,
  type CalibrationServerModel,
  clearDetectionModel,
  emptyModel,
  loadDetectionModel,
  saveDetectionModel,
} from '../model-settings';
import { CalibrationModelModal } from './CalibrationModelModal';
export function CameraDetectionActions({
  detect,
  detecting,
  detectionKind,
  markersDisabled,
  aiDisabled,
  settingsDisabled,
  detectionModel,
  onDetectAI = true,
}: {
  detect(
    kind?: 'markers' | 'ai',
    model?: CalibrationModelConfig,
  ): Promise<void>;
  detecting: boolean;
  detectionKind: 'markers' | 'ai';
  markersDisabled: boolean;
  aiDisabled: boolean;
  settingsDisabled: boolean;
  detectionModel?: CalibrationServerModel;
  onDetectAI?: boolean;
}) {
  useCalibrationLanguage((state) => state.language);
  const [rememberedModel] = useState(loadDetectionModel);
  const [model, setModel] = useState(rememberedModel?.config ?? emptyModel());
  const [customModel, setCustomModel] = useState(
    rememberedModel?.custom ?? !detectionModel?.modelName,
  );
  const [modelOpen, setModelOpen] = useState(false);
  const [modelStorageError, setModelStorageError] = useState<string>();
  const [detectAfterSettings, setDetectAfterSettings] = useState(false);
  const detectAI = () => {
    if (
      customModel
        ? !model.modelName.trim() || !model.modelFamily.trim()
        : !detectionModel?.modelName
    ) {
      setDetectAfterSettings(true);
      setModelOpen(true);
    } else void detect('ai', customModel ? model : undefined);
  };
  return (
    <>
      <>
        <Button
          size="small"
          loading={detecting && detectionKind === 'markers'}
          disabled={markersDisabled || detecting}
          onClick={() => void detect()}
        >
          {t('Detect screen markers')}
        </Button>
        {onDetectAI && (
          <Button
            size="small"
            loading={detecting && detectionKind === 'ai'}
            disabled={aiDisabled || detecting}
            onClick={detectAI}
          >
            {t('Use AI detection')}
          </Button>
        )}
        {onDetectAI && (
          <Button
            size="small"
            type="text"
            disabled={settingsDisabled || detecting}
            onClick={() => {
              setDetectAfterSettings(false);
              setModelOpen(true);
            }}
          >
            {t('AI model settings')}
          </Button>
        )}
      </>
      <CalibrationModelModal
        open={modelOpen}
        title={t('AI model settings')}
        description={t(
          'AI detection uses a camera image to locate the full screen. Check the corners before saving.',
        )}
        serverModel={detectionModel}
        value={model}
        custom={customModel}
        onClose={() => setModelOpen(false)}
        error={modelStorageError}
        persistenceNotice={t(
          'Model settings, including the API key, are saved in this browser. Clear them here when no longer needed.',
        )}
        onClear={() => {
          try {
            clearDetectionModel();
            setModelStorageError(undefined);
          } catch {
            setModelStorageError(
              t('Unable to clear saved model settings in this browser.'),
            );
            return;
          }
          setModel(emptyModel());
          setCustomModel(false);
        }}
        onApply={(config, custom) => {
          try {
            saveDetectionModel(config, custom);
            setModelStorageError(undefined);
          } catch {
            setModelStorageError(
              t('Unable to save model settings in this browser.'),
            );
            return;
          }
          setModel(config);
          setCustomModel(custom);
          setModelOpen(false);
          if (detectAfterSettings)
            void detect('ai', custom ? config : undefined);
        }}
      />
    </>
  );
}
