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
    <div className="ios-hid-airplay-guide">
      <p className="ios-hid-airplay-instruction">
        打开手机「控制中心 → 屏幕镜像」
      </p>
      <div className="ios-hid-airplay-receiver">{name}</div>
      <div className="ios-hid-airplay-code">
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
  return (
    <div className="ios-hid-airplay-preview">
      <div className="ios-hid-airplay-header">
        <span>
          AirPlay{' '}
          {info && (
            <span className="ios-hid-airplay-muted">／ {info.name}</span>
          )}
        </span>
        <span className="ios-hid-airplay-status">
          {(!info || info.state === 'waiting' || verifying) && (
            <span className="ios-hid-waiting-ring" aria-hidden="true" />
          )}
          {airplayStatusText(info, verifying)}
        </span>
      </div>
      <div
        className={`ios-hid-airplay-body${streaming || verifying ? '' : ' ios-hid-airplay-unavailable'}`}
      >
        <Frame
          url={frameUrl}
          active={streaming && !verifying}
          showError={false}
        />
        {!streaming && !verifying && (
          <div className="ios-hid-airplay-empty">
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
  );
}
