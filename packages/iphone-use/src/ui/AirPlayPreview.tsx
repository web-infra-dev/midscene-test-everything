import type { AirPlaySetupInfo } from '../hardware/types.js';
import { Frame } from './ScreenPreview';
import './airplay.css';

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
  return (
    <div className="iphone-use-airplay-guide">
      <p className="iphone-use-airplay-instruction">
        打开手机「控制中心 → 屏幕镜像」
      </p>
      <div className="iphone-use-airplay-receiver">{name}</div>
      <div className="iphone-use-airplay-code">
        <span>配对码</span>
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
}: {
  info?: AirPlaySetupInfo;
  frameUrl: string;
  verifying?: boolean;
}) {
  const streaming = info?.state === 'streaming';
  const ready = streaming || verifying;
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
                {!info
                  ? '正在准备接收器…'
                  : info.state === 'failed'
                    ? '接收器无法启动'
                    : info.state === 'interrupted'
                      ? '投屏画面已中断'
                      : '等待手机投屏'}
              </strong>
              {info?.state === 'failed' ? (
                <p>{info.error}</p>
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
          <span>蓝牙已连接</span>
        </div>
        <div
          className={`iphone-use-progress-step ${ready ? 'done' : 'active'}`}
        >
          <i />
          <span>AirPlay 画面就绪</span>
        </div>
        <div
          className={`iphone-use-progress-step ${verifying ? 'active' : ''}`}
        >
          <i />
          <span>指针校准</span>
        </div>
      </div>
    </div>
  );
}
