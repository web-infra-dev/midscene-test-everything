import { Button, Typography } from 'antd';
import { Cable, Check, Circle } from 'lucide-react';
import type { CameraEntry } from '../cameras';
import { usePreferences } from '../i18n';
import './RobotReadinessCard.less';

export function RobotReadinessCard({
  camera,
  onOpenSetup,
  connected = true,
  disabled = false,
  actionLabel,
}: {
  camera?: CameraEntry;
  onOpenSetup(): void;
  connected?: boolean;
  disabled?: boolean;
  actionLabel?: string;
}) {
  const zh = usePreferences((s) => s.language) === 'zh';
  const steps = [
    {
      label: connected
        ? zh
          ? '机械臂已连接'
          : 'Arm connected'
        : zh
          ? '连接机械臂'
          : 'Connect robot',
      done: connected,
    },
    {
      label: zh ? '相机运行中' : 'Camera running',
      done: camera?.stream?.state === 'running',
    },
    {
      label: zh ? '屏幕校正' : 'Screen correction',
      done: Boolean(camera?.hasCorrection),
    },
    { label: zh ? '屏幕标定' : 'Screen calibration', done: false },
  ];
  return (
    <section
      className="robot-readiness-card"
      aria-label={zh ? '设备准备进度' : 'Device setup progress'}
    >
      <div className="robot-readiness-head">
        <Typography.Text strong>
          {zh ? '完成设备配置' : 'Finish device setup'}
        </Typography.Text>
        <span>
          {steps.filter((step) => step.done).length} / {steps.length}
        </span>
      </div>
      {!connected && (
        <Typography.Paragraph type="secondary" className="robot-readiness-hint">
          {zh
            ? '可先预览相机、识别屏幕，连接机械臂后继续标定。'
            : 'Preview the camera and detect screens, then connect the robot to continue calibration.'}
        </Typography.Paragraph>
      )}
      <ul>
        {steps.map((step) => (
          <li key={step.label} data-done={step.done}>
            <span
              className="readiness-mark"
              role="img"
              aria-label={
                step.done
                  ? zh
                    ? '已完成'
                    : 'Complete'
                  : zh
                    ? '待完成'
                    : 'Pending'
              }
            >
              {step.done ? (
                <Check size={18} strokeWidth={2.75} aria-hidden />
              ) : (
                <Circle size={14} aria-hidden />
              )}
            </span>
            <span>{step.label}</span>
          </li>
        ))}
      </ul>
      <Button
        type="primary"
        icon={connected ? undefined : <Cable size={16} />}
        disabled={disabled}
        onClick={onOpenSetup}
      >
        {actionLabel ??
          (connected
            ? zh
              ? '进入标定'
              : 'Open calibration'
            : zh
              ? '连接机械臂'
              : 'Connect robot')}
      </Button>
    </section>
  );
}
