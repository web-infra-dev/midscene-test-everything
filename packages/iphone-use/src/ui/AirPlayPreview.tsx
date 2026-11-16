import type { AirPlaySetupInfo } from '../hardware/types.js';
import { Frame } from './ScreenPreview';
import './airplay.css';
import { useI18n } from './i18n';

function ScreenMirroringIcon() {
  return (
    <svg
      aria-hidden="true"
      width="32"
      height="32"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1" />
      <rect x="8" y="9" width="14" height="12" rx="2" />
    </svg>
  );
}
function ReceiverGuide({ name, pin }: { name: string; pin: string }) {
  const { t } = useI18n();
  return (
    <div className="iphone-use-airplay-guide">
      <p className="iphone-use-airplay-instruction">
        {t(
          '打开手机「控制中心 → 屏幕镜像」',
          'Open Control Center → Screen Mirroring',
        )}
      </p>
      <div className="iphone-use-airplay-receiver">{name}</div>
      <div className="iphone-use-airplay-code">
        <span>{t('配对码', 'Passcode')}</span>
        <strong>{pin}</strong>
      </div>
    </div>
  );
}
export function airplayStatusText(info?: AirPlaySetupInfo, verifying = false) {
  if (verifying) return '正在验证指针…';
  if (!info) return '正在启动接收器…';
  return {
    waiting: '等待手机投屏…',
    streaming: '已收到手机画面',
    interrupted: '画面已中断',
    failed: '接收器启动失败',
  }[info.state];
}
export function AirPlayPreview({
  info,
  frameUrl,
  verifying = false,
  setupError,
}: {
  info?: AirPlaySetupInfo;
  frameUrl: string;
  verifying?: boolean;
  setupError?: string;
}) {
  const { t, te } = useI18n();
  const streaming = info?.state === 'streaming';
  const ready = streaming || verifying;
  const failed = info?.state === 'failed' || (!info && Boolean(setupError));
  return (
    <div className="iphone-use-pending-preview">
      <div className="iphone-use-phone-bezel iphone-use-pending-bezel">
        <div className="iphone-use-phone-screen">
          {ready ? (
            <Frame
              url={frameUrl}
              active={streaming && !verifying}
              showError={false}
            />
          ) : (
            <div className="iphone-use-airplay-screen-guide">
              <ScreenMirroringIcon />
              <strong>
                {failed
                  ? t('接收器无法启动', 'Receiver failed to start')
                  : !info
                    ? t('正在准备接收器…', 'Starting receiver…')
                    : info.state === 'interrupted'
                      ? t('投屏画面已中断', 'Mirroring interrupted')
                      : t('等待手机投屏', 'Waiting for Screen Mirroring')}
              </strong>
              {failed ? (
                <p>{te(info?.error ?? setupError ?? '')}</p>
              ) : (
                info && <ReceiverGuide name={info.name} pin={info.pin} />
              )}
            </div>
          )}
        </div>
      </div>
      <div className="iphone-use-pending-progress">
        <div className="iphone-use-progress-step done">
          <i />
          <span>{t('蓝牙已连接', 'Bluetooth Ready')}</span>
        </div>
        <div
          className={`iphone-use-progress-step ${ready ? 'done' : 'active'}`}
        >
          <i />
          <span>{t('AirPlay 画面就绪', 'AirPlay Ready')}</span>
        </div>
        <div
          className={`iphone-use-progress-step ${verifying ? 'active' : ''}`}
        >
          <i />
          <span>{t('指针校准', 'Pointer Calibrated')}</span>
        </div>
      </div>
    </div>
  );
}
