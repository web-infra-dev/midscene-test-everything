import { Button, Select, Space, Switch, Typography } from 'antd';
import { Volume2, VolumeX } from 'lucide-react';

import { useCalibrationLanguage } from '../i18n';
const useLanguage = () => useCalibrationLanguage((state) => state.language);
import { robotVoice, useVoiceSettings } from './browser';

export function VoiceSettings({
  compact = false,
  className,
}: { compact?: boolean; className?: string }) {
  const language = useLanguage();
  const {
    enabled,
    supported,
    error,
    setEnabled,
    voices,
    selectedVoice,
    setVoice,
  } = useVoiceSettings();
  const label = language === 'zh' ? '声音提示' : 'Sound';
  if (compact)
    return (
      <Button
        type="text"
        className={className}
        aria-label={label}
        aria-pressed={enabled}
        title={label}
        icon={
          enabled ? (
            <Volume2 size={16} strokeWidth={1.8} />
          ) : (
            <VolumeX size={16} strokeWidth={1.8} />
          )
        }
        onClick={() => setEnabled(!enabled)}
      />
    );
  return (
    <div className="control-group">
      <Typography.Text className="control-label" type="secondary">
        {label}
      </Typography.Text>
      <Space size={8} wrap>
        <Switch aria-label={label} checked={enabled} onChange={setEnabled} />
        <Button
          aria-label={language === 'zh' ? '试听' : 'Test Voice'}
          disabled={!supported || !enabled}
          onClick={() => robotVoice.notify('preview', 1)}
        >
          {language === 'zh' ? '试听' : 'Test Voice'}
        </Button>
      </Space>
      {supported && voices.length > 0 && (
        <Select
          popupClassName="robot-select-menu"
          aria-label={language === 'zh' ? '音色' : 'Voice'}
          value={
            voices.some((voice) => voice.voiceURI === selectedVoice)
              ? selectedVoice
              : ''
          }
          onChange={setVoice}
          options={[
            {
              value: '',
              label: language === 'zh' ? '自动选择音色' : 'Automatic Voice',
            },
            ...voices.map((voice) => ({
              value: voice.voiceURI,
              label: `${voice.name} (${voice.lang})`,
            })),
          ]}
        />
      )}
      {(!supported || error) && (
        <Typography.Text type="secondary">
          {language === 'zh'
            ? '语音不可用，请检查浏览器及系统音色。'
            : 'Voice unavailable. Check browser and system voices.'}
        </Typography.Text>
      )}
    </div>
  );
}
