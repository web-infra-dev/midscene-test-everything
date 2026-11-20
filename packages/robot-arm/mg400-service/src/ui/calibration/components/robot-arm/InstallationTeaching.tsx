import { Alert, Button, Checkbox, Space, Typography } from 'antd';
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../../i18n';
import type {
  InstallationTeachingDraft,
  InstallationTeachingPoint,
  InstallationTeaching as SavedTeaching,
} from '../../robot-arm-api';
import type {
  TeachingBinding as ProfileBinding,
  TeachingClient as RobotArmApi,
} from '../../teaching-client';
import { speakCalibration } from '../../voice/calibration';
import { TeachingDiagram } from './TeachingDiagram';
const points: InstallationTeachingPoint[] = [
  'reference',
  'cameraBoundary',
  'cameraBoundaryEnd',
];
const labels = {
  reference: 'Reference Position',
  cameraBoundary: 'Camera-side Boundary A',
  cameraBoundaryEnd: 'Camera-side Boundary B',
};
const teachingVoice = {
  reference: 'teachReference',
  cameraBoundary: 'teachBoundary',
  cameraBoundaryEnd: 'teachBoundary',
  review: 'confirmCorridor',
} as const;
const prompts = {
  reference:
    'Hold the tip 2–5 cm above the screen centre. Free travel stays at this height or above.',
  cameraBoundary:
    'At the reference height, place the tip at the first point on the intended boundary. Keep the whole arm clear of the camera and stand.',
  cameraBoundaryEnd:
    'Move along the intended boundary at the reference height. Record point B at least 20 mm from A.',
};
export function InstallationTeaching({
  api,
  binding,
  screenName,
  disabled,
  onSaved,
  onPointRecorded,
  boundaryPreviewAvailable,
  footer,
  preview,
  externalPreview = false,
  illustrationContainer,
}: {
  api: RobotArmApi;
  binding: ProfileBinding;
  /** Screen the reference is recorded above, named in the placement prompt. */
  screenName?: string;
  disabled: boolean;
  footer?: HTMLElement | null;
  preview?: ReactNode;
  externalPreview?: boolean;
  illustrationContainer?: HTMLElement | null;
  onSaved?: () => void;
  onPointRecorded?: () => void;
  boundaryPreviewAvailable?: boolean;
}) {
  const [saved, setSaved] = useState<SavedTeaching | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [stateReady, setStateReady] = useState(false);
  const [draft, setDraft] = useState<InstallationTeachingDraft | null>(null);
  const [stage, setStage] = useState<InstallationTeachingPoint | 'review'>(
    'reference',
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (loaded) speakCalibration(teachingVoice[stage]);
  }, [loaded, stage]);
  useEffect(() => {
    let alive = true;
    setSaved(null);
    void api
      .installationTeaching()
      .then((value) => {
        if (
          alive &&
          value &&
          !value.invalidatedReason &&
          value.robotProfileId === binding.robotProfileId &&
          value.toolProfileId === binding.toolProfileId &&
          value.cameraId === binding.cameraId
        )
          setSaved(value);
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      });
    setLoaded(false);
    setStateReady(false);
    setDraft(null);
    setStage('reference');
    setConfirmed(false);
    void api
      .installationTeachingDraft()
      .then((value) => {
        if (
          alive &&
          value &&
          value.robotProfileId === binding.robotProfileId &&
          value.toolProfileId === binding.toolProfileId &&
          value.cameraId === binding.cameraId
        ) {
          setDraft(value);
          setStage(points.find((point) => !value.poses[point]) ?? 'review');
        }
      })
      .catch((cause) => {
        if (alive) setError(String(cause));
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    const update = async () => {
      try {
        const state = await api.state();
        if (alive) {
          setStateReady(true);
          setEnabled(Boolean(state.state.enabled));
          setDragging(Boolean(state.state.dragMode));
          setMoving(Boolean(state.state.moving));
        }
      } catch (cause) {
        if (alive) {
          setStateReady(false);
          setError(String(cause));
        }
      }
    };
    void update();
    const timer = setInterval(() => void update(), 1000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [
    api,
    binding.robotProfileId,
    binding.toolProfileId,
    binding.screenProfileId,
    binding.cameraId,
  ]);
  const work = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const confirmationKey = draft
    ? `robot-teaching-confirmation:${JSON.stringify([binding.robotProfileId, binding.toolProfileId, binding.screenProfileId, draft.context, draft.id])}`
    : undefined;
  useEffect(() => {
    let checked = false;
    try {
      checked = Boolean(
        confirmationKey && localStorage.getItem(confirmationKey) === 'true',
      );
    } catch {
      /* Storage unavailable: require confirmation in this view. */
    }
    setConfirmed(checked);
  }, [confirmationKey]);
  const confirm = (checked: boolean) => {
    setConfirmed(checked);
    try {
      if (confirmationKey)
        localStorage.setItem(confirmationKey, String(checked));
    } catch {
      /* Keep the current view usable without persistent storage. */
    }
  };
  const complete = points.every((point) => draft?.poses[point]);
  const controls = (
    <Space wrap>
      <Button
        disabled={busy || !loaded || !stateReady || (disabled && !dragging)}
        onClick={() =>
          void work(async () => {
            if (dragging) {
              await api.exitDrag();
              speakCalibration('exitDrag');
            } else {
              speakCalibration('beforeDrag', 2);
              await api.enterTeachingDrag(binding);
            }
            const state = await api.state();
            setDragging(Boolean(state.state.dragMode));
            setEnabled(Boolean(state.state.enabled));
          })
        }
      >
        {t(
          dragging
            ? 'Exit Drag Mode'
            : enabled
              ? 'Enter Drag Mode'
              : 'Enable and Enter Drag Mode',
        )}
      </Button>
      <Button
        type="primary"
        loading={busy}
        disabled={
          disabled ||
          !loaded ||
          !stateReady ||
          !enabled ||
          moving ||
          (stage === 'review' && (!complete || !confirmed))
        }
        onClick={() =>
          void work(async () => {
            if (stage === 'review') {
              if (dragging) {
                await api.exitDrag();
                setDragging(false);
              }
              const teaching = await api.teachInstallation({
                binding,
                draftId: draft!.id,
                corridorConfirmed: confirmed,
              });
              setSaved(teaching);
              speakCalibration('teachingSaved');
              onSaved?.();
            } else {
              const next = await api.captureInstallationPoint(binding, stage);
              setDraft(next);
              setConfirmed(false);
              setStage(points.find((point) => !next.poses[point]) ?? 'review');
              onPointRecorded?.();
            }
          })
        }
      >
        {t(
          stage === 'review' ? 'Save and Calibrate' : 'Record Current Position',
        )}
      </Button>
    </Space>
  );
  return (
    <div
      className={`robot-teaching-layout${externalPreview ? ' has-external-preview' : ''}`}
    >
      <section data-installation-teaching aria-label={t('Teach Installation')}>
        <Space wrap>
          {points.map((point) => (
            <Button
              key={point}
              type={stage === point ? 'primary' : 'default'}
              disabled={
                busy ||
                disabled ||
                (point !== 'reference' && !draft?.poses.reference) ||
                (point === 'cameraBoundaryEnd' && !draft?.poses.cameraBoundary)
              }
              onClick={() => {
                setStage(point);
              }}
            >
              {draft?.poses[point] ? '✓ ' : ''}
              {t(labels[point])}
            </Button>
          ))}
        </Space>
        {error && <Alert type="error" message={t(error)} />}
        <Typography.Title level={4}>
          {t(
            stage === 'review' ? 'Review Installation Teaching' : labels[stage],
          )}
        </Typography.Title>
        {stage !== 'review' ? (
          <>
            <Typography.Paragraph>
              {stage === 'reference' && screenName
                ? t(
                    'Hold the tip 2–5 cm above the centre of "{0}". Free travel stays at this height or above.',
                    [screenName],
                  )
                : t(prompts[stage])}
            </Typography.Paragraph>
            {illustrationContainer === undefined && (
              <TeachingDiagram stage={stage} />
            )}
            <Typography.Paragraph type="secondary">
              {t('Hold still, then record. Drag Mode can stay on.')}
            </Typography.Paragraph>
            {stage === 'reference' && draft?.poses.reference && (
              <Alert
                type="info"
                message={t(
                  'Recording a new reference clears the other taught points. Saved installation remains unchanged until you save.',
                )}
              />
            )}
          </>
        ) : (
          <>
            {boundaryPreviewAvailable === false && (
              <Typography.Paragraph type="secondary">
                {t(
                  'The live boundary overlay requires an existing screen calibration for this camera view. Check the line from A to B directly.',
                )}
              </Typography.Paragraph>
            )}
            <Typography.Paragraph>
              {t(
                'Free travel stays above the reference height and on the screen side of the boundary.',
              )}
            </Typography.Paragraph>
            <Checkbox
              checked={confirmed}
              onChange={(event) => confirm(event.target.checked)}
            >
              {t(
                'The phone is horizontal, the stylus is vertical, and the full arm has camera clearance on the reference side of the boundary. There are no other obstacles.',
              )}
            </Checkbox>
            <details className="robot-disclosure">
              <summary>{t('Learn more')}</summary>
              <Typography.Paragraph type="secondary">
                {t(
                  'Contact search remains limited to 60 mm below the reference. Other directions are not constrained by a taught box.',
                )}
              </Typography.Paragraph>
            </details>
          </>
        )}
        {illustrationContainer &&
          createPortal(
            <TeachingDiagram
              stage={stage === 'review' ? 'cameraBoundary' : stage}
            />,
            illustrationContainer,
          )}
        {footer ? createPortal(controls, footer) : controls}
      </section>
      {(!externalPreview || saved) && (
        <aside className="robot-teaching-camera" aria-label={t('Live Preview')}>
          {!externalPreview && (
            <Typography.Title level={4}>{t('Live Preview')}</Typography.Title>
          )}
          {saved && (
            <div
              className="robot-teaching-saved-positions"
              aria-label={t('Saved Teaching Positions')}
            >
              <Typography.Paragraph strong>
                {t('Saved Teaching Positions')}
              </Typography.Paragraph>
              <Space wrap>
                {points
                  .filter(
                    (point) => point === 'reference' || saved.poses?.[point],
                  )
                  .map((point) => (
                    <Button
                      key={point}
                      disabled={
                        disabled ||
                        busy ||
                        dragging ||
                        moving ||
                        !enabled ||
                        !stateReady
                      }
                      onClick={() =>
                        void work(async () => {
                          const current = await api.state();
                          speakCalibration(
                            point === 'reference'
                              ? 'approachStart'
                              : 'gotoBoundary',
                            2,
                          );
                          await api.gotoTeachingPosition(
                            binding,
                            saved.id,
                            point,
                            current.stopRevision,
                          );
                        })
                      }
                    >
                      {t('Go to {0}', [
                        t(
                          point === 'reference'
                            ? 'Reference Position'
                            : labels[point],
                        ),
                      ])}
                    </Button>
                  ))}
              </Space>
            </div>
          )}

          {!externalPreview && (
            <figure className="robot-setup-media-slot">
              <div className="robot-setup-media-content">
                <div className="robot-setup-reference-preview">
                  {preview ?? (
                    <div className="robot-device-preview-empty">
                      {t('Main camera unavailable')}
                    </div>
                  )}
                </div>
              </div>
            </figure>
          )}
          <Typography.Paragraph type="secondary">
            {t('Check the whole arm directly before recording.')}
          </Typography.Paragraph>
        </aside>
      )}
    </div>
  );
}
