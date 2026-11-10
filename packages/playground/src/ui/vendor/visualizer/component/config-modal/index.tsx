import { ConfigModal as SharedConfigModal, type ConfigModalProps } from '@midscene/arm-calibration-ui';
import { usePlaygroundTranslation } from '../universal-playground/translation';
export * from '@midscene/arm-calibration-ui/model-config';
export function ConfigModal(props: ConfigModalProps) {
  const t = usePlaygroundTranslation();
  return <SharedConfigModal {...props} translate={t} />;
}
