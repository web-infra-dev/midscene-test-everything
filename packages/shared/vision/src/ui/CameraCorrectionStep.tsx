import { Button } from 'antd';
import type { ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { ScreenMappingView } from './ScreenMappingView.js';
import { cameraSetupErrorText } from './camera-error.js';
export function CameraCorrectionStep({
  error,
  verified,
  detecting,
  saving,
  disabled,
  onContinue,
  continueLabel,
  footer,
  ...view
}: ComponentProps<typeof ScreenMappingView> & {
  error?: string;
  verified: boolean;
  detecting: boolean;
  saving: boolean;
  disabled: boolean;
  onContinue(): void;
  continueLabel: string;
  footer?: HTMLElement | null;
}) {
  const button = (
    <Button
      type="primary"
      loading={saving}
      disabled={disabled || detecting || saving}
      onClick={onContinue}
    >
      {continueLabel}
    </Button>
  );
  return (
    <>
      <ScreenMappingView {...view} />
      <output
        className={`vision-calibration-status${error ? ' is-warning' : ''}`}
      >
        {error
          ? cameraSetupErrorText(error)
          : detecting
            ? ''
            : verified
              ? '校验通过，请确认画面包含完整屏幕后继续。'
              : '拖动四角对齐屏幕边缘，或使用自动识别。'}
      </output>
      {footer ? (
        createPortal(button, footer)
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          {button}
        </div>
      )}
    </>
  );
}
