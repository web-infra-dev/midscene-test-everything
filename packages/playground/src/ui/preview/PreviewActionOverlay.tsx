import { PreviewActionOverlay as ActionOverlay } from '@midscene/preview-controls';
import '@midscene/preview-controls/styles.css';
import type { PreviewActionFeedback } from '../hooks/usePreviewControl';
import { useLanguage } from '../i18n';
import type { PreviewGestureDraft } from './gesture';
import type { PreviewProjection } from './projection';

export function PreviewActionOverlay({
  projection,
  draft,
  feedback,
}: {
  projection: PreviewProjection;
  draft?: PreviewGestureDraft;
  feedback?: PreviewActionFeedback;
}) {
  const language = useLanguage();
  const action = feedback?.action;
  const target = feedback?.target ?? projection;
  const display = draft
    ? 'imagePoint' in draft
      ? { type: draft.type, point: draft.imagePoint }
      : { type: 'swipe' as const, from: draft.imageFrom, to: draft.imageTo }
    : action
      ? 'point' in action
        ? { type: action.type, point: target.toImage(action.point) }
        : {
            type: 'swipe' as const,
            from: target.toImage(action.from),
            to: target.toImage(action.to),
          }
      : undefined;
  return display ? (
    <ActionOverlay
      width={projection.width}
      height={projection.height}
      action={display}
      status={feedback?.status}
      targetName={feedback?.targetName}
      language={language}
    />
  ) : null;
}
