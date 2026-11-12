import { useId } from 'react';

type Point = { x: number; y: number };

export type PreviewAction =
  | { type: 'tap' | 'longPress'; point: Point }
  | { type: 'swipe'; from: Point; to: Point };

export type PreviewFeedbackStatus =
  | 'preparing'
  | 'executing'
  | 'completed'
  | 'failed';

function actionText(action: PreviewAction, zh: boolean) {
  switch (action.type) {
    case 'longPress':
      return zh ? '长按' : 'Long press';
    case 'swipe':
      return zh ? '滑动' : 'Swipe';
    default:
      return zh ? '点击' : 'Tap';
  }
}

function statusText(status: PreviewFeedbackStatus, zh: boolean) {
  switch (status) {
    case 'preparing':
      return zh ? '准备动作' : 'Preparing action';
    case 'executing':
      return zh ? '执行中' : 'Executing';
    case 'completed':
      return zh ? '动作完成' : 'Action completed';
    default:
      return zh ? '动作失败' : 'Action failed';
  }
}

export function PreviewActionOverlay({
  width,
  height,
  action,
  status,
  targetName,
  language,
}: {
  width: number;
  height: number;
  action: PreviewAction;
  status?: PreviewFeedbackStatus;
  targetName?: string;
  language: 'en' | 'zh';
}) {
  const zh = language === 'zh';
  const markerId = useId().replace(/:/g, '');
  const start = action.type === 'swipe' ? action.from : action.point;
  const end = action.type === 'swipe' ? action.to : action.point;
  const radius = Math.max(width, height) * 0.018;
  return (
    <div
      className={`preview-action-overlay${status ? ` preview-action-${status}` : ' preview-action-drawing'}`}
      data-testid="preview-action-feedback"
      data-status={status ?? 'drawing'}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {action.type === 'swipe' ? (
          <>
            <line
              className="preview-action-path-shadow"
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
            />
            <line
              className="preview-action-path"
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              markerEnd={`url(#${markerId})`}
            />
            <circle
              className="preview-action-origin"
              cx={start.x}
              cy={start.y}
              r={radius * 0.5}
            />
          </>
        ) : null}
        <circle
          className="preview-action-ring"
          cx={end.x}
          cy={end.y}
          r={radius}
        />
        <circle
          className="preview-action-dot"
          cx={end.x}
          cy={end.y}
          r={radius * 0.3}
        />
        {status === 'completed' ? (
          <path
            className="preview-action-result"
            d={`M ${end.x - radius * 0.5} ${end.y} l ${radius * 0.35} ${radius * 0.35} l ${radius * 0.7} ${-radius * 0.7}`}
          />
        ) : null}
        {status === 'failed' ? (
          <path
            className="preview-action-result"
            d={`M ${end.x - radius * 0.4} ${end.y - radius * 0.4} l ${radius * 0.8} ${radius * 0.8} m 0 ${-radius * 0.8} l ${-radius * 0.8} ${radius * 0.8}`}
          />
        ) : null}
      </svg>
      <output className="preview-action-status" aria-live="polite">
        <span className="preview-action-status-dot" />
        <strong>{actionText(action, zh)}</strong>
        <span>
          {status
            ? statusText(status, zh)
            : zh
              ? '释放后执行'
              : 'Release to execute'}
        </span>
        {targetName && (
          <span className="preview-action-target">{targetName}</span>
        )}
      </output>
    </div>
  );
}
