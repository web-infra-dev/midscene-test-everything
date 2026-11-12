import { ConfigModal as SharedConfigModal, type ConfigModalProps } from '../../../../ModelConfigModal';
import { usePlaygroundTranslation } from '../universal-playground/translation';
export * from '../../../../ModelConfigModal';
export function ConfigModal(props: ConfigModalProps) {
  const t = usePlaygroundTranslation();
  return <SharedConfigModal {...props} translate={t} />;
}
