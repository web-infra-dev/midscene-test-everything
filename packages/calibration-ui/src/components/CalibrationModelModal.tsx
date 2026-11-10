import type { ConnectivityTestResult } from '@midscene/core';
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import { createContext, useContext } from 'react';
import type {
  CalibrationModelConfig,
  CalibrationServerModel,
} from '../model-settings';
import { parseModelEnvironment } from '../utils/modelEnv';
import { ConfigModal } from './ModelConfigModal';

export const CalibrationModelVerifier = createContext<
  ((env: Record<string, string>) => Promise<ConnectivityTestResult>) | undefined
>(undefined);
export interface CalibrationModelModalProps {
  open: boolean;
  title?: string;
  description?: string;
  serverModel?: CalibrationServerModel;
  value: CalibrationModelConfig;
  custom: boolean;
  onApply: (config: CalibrationModelConfig, custom: boolean) => void;
  onClear: () => void;
  onClose: () => void;
  persistenceNotice?: string;
  error?: string;
}
const translate = (message: string, values: readonly unknown[] = []) =>
  message.replace(/\{(\d+)\}/g, (match, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  );

export function CalibrationModelModal(props: CalibrationModelModalProps) {
  const verify = useContext(CalibrationModelVerifier);
  const text = [
    ['BASE_URL', props.value.baseUrl],
    ['API_KEY', props.value.apiKey],
    ['NAME', props.value.modelName],
    ['FAMILY', props.value.modelFamily],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `MIDSCENE_MODEL_${key}=${value}`)
    .join('\n');
  return (
    <ConfigProvider theme={{ inherit: false }} locale={enUS}>
      <ConfigModal
        open={props.open}
        onClose={props.onClose}
        textValue={text}
        showAgentOptions={false}
        translate={translate}
        onVerify={verify}
        onSave={({ text }) => {
          if (!text.trim()) {
            props.onClear();
            props.onClose();
            return;
          }
          props.onApply(
            {
              modelName: '',
              modelFamily: '',
              baseUrl: '',
              apiKey: '',
              ...parseModelEnvironment(text),
            },
            true,
          );
        }}
      />
    </ConfigProvider>
  );
}
