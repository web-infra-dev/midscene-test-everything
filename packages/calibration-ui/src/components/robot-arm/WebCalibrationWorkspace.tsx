import { Button, Checkbox, Radio, Typography } from 'antd';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalibrationRequestError } from '../../client';
import type { AssistedCalibrationController } from '../../hooks/useAssistedCalibration';
import { calibrationErrorText, t, useCalibrationLanguage } from '../../i18n';
import {
  type CalibrationProfile,
  calibrationAccepted,
} from '../../robot-arm-api';
import { ExplorationQualitySummary } from './CalibrationQualityWarnings';
import { ExplorationProgress } from './ExplorationProgress';
import { SetupNotice } from './SetupNotice';

export function WebCalibrationWorkspace({
  controller,
  result,
  readyToCapture = true,
  readyToStart = true,
  cameraCheckRequired = false,
  prepareFromTeaching = false,
  showSessionCancel = true,
  footer,
  preview,
  externalPreview = false,
  controls,
  onActivated,
  onBeforeLeaveChange,
  onReturn,
  onRestart,
  completionLabel = 'Back to Overview',
  onCheckCamera,
  onConnectPhone,
}: {
  controller: AssistedCalibrationController;
  result?: CalibrationProfile;
  readyToCapture?: boolean;
  readyToVerify?: boolean;
  readyToStart?: boolean;
  cameraCheckRequired?: boolean;
  prepareFromTeaching?: boolean;
  showSessionCancel?: boolean;
  footer: HTMLElement | null;
  preview?: ReactNode;
  externalPreview?: boolean;
  controls?: ReactNode;
  onActivated(): Promise<void>;
  onBeforeLeaveChange?(handler: (() => Promise<void>) | null): void;
  onReturn?(): void;
  onRestart?(): void;
  completionLabel?: string;
  onCheckCamera?(): void;
  onConnectPhone?(): void;
}) {
  useCalibrationLanguage((state) => state.language);
  const { session: s, setup, busy, error } = controller;
  const [mode, setMode] = useState<'slide' | 'standard'>('slide');
  const [confirmed, setConfirmed] = useState(false);
  const [saveConfirmed, setSaveConfirmed] = useState(false);
  const [reviewStep, setReviewStep] = useState<number>();
  const stage = s?.stage;
  const offerStandardRetry =
    stage === 'interrupted' &&
    !s?.awaitingSocketRecovery &&
    s?.collectionFailed &&
    s.explorationMode === 'slide';
  const completed =
    stage === 'completed' || (!s && calibrationAccepted(result));
  const activeMotion =
    stage === 'collecting' ||
    stage === 'safety' ||
    stage === 'returning' ||
    stage === 'avoiding-camera';
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const checkBeforeStart =
    (s || setup.prepared) &&
    (cameraCheckRequired || (!setup.mapping && !s?.mapping)) &&
    onCheckCamera;
  const start = (work: () => Promise<unknown>) => {
    if (checkBeforeStart) {
      checkBeforeStart();
      return;
    }
    void work().catch((cause) => {
      if (
        mounted.current &&
        cause instanceof CalibrationRequestError &&
        cause.requiresCameraCheck
      )
        onCheckCamera?.();
    });
  };
  const command = (
    action: Parameters<typeof controller.command>[0],
    confirm = false,
  ) => void controller.command(action, confirm).catch(() => undefined);
  useEffect(() => {
    setConfirmed(false);
    setSaveConfirmed(false);
    setReviewStep(undefined);
  }, [stage, s?.id, s?.teachingId]);
  useEffect(() => {
    onBeforeLeaveChange?.(async () => {
      if (s && !completed && !['cancelled', 'interrupted'].includes(s.stage))
        await controller.command('cancel');
    });
    return () => onBeforeLeaveChange?.(null);
  }, [s?.id, stage, completed, controller.command, onBeforeLeaveChange]);
  // The guided workspace is keyed by screen and attempt. Preparing a session
  // resolves the screen-specific reference without starting any robot motion.
  const prepared = useRef(false);
  useEffect(() => {
    if (
      !prepareFromTeaching ||
      prepared.current ||
      s ||
      completed ||
      busy ||
      !readyToStart ||
      !setup.teaching ||
      !setup.mapping ||
      !setup.phoneConnected
    )
      return;
    prepared.current = true;
    start(controller.create);
  }, [
    prepareFromTeaching,
    s,
    completed,
    busy,
    readyToStart,
    setup.teaching,
    setup.mapping,
    setup.phoneConnected,
    controller.create,
  ]);
  const firstStep = s?.teachingId && s.referencePosition ? 1 : 0;
  const quality = s?.explorationQuality;
  const steps = [
    'Set a calibration reference position',
    'Collect calibration points',
    'Boundary verification',
    'Set a safe position',
    'Save and Use',
  ];
  const index =
    completed || stage === 'review'
      ? 4
      : stage === 'ready' &&
          s?.referencePosition &&
          !s.teachingId &&
          s.cameraBoundaryPosition
        ? 0
        : stage === 'return-ready' ||
            stage === 'positioning-safe' ||
            stage === 'avoiding-camera'
          ? 3
          : stage === 'safety' ||
              stage === 'returning' ||
              stage === 'boundary-review'
            ? 2
            : stage === 'collecting' ||
                (stage === 'ready' &&
                  s?.referencePosition &&
                  (s.teachingId || !s.cameraBoundaryPosition))
              ? 1
              : firstStep;
  const canReview = !busy && !activeMotion && stage !== 'positioning-safe';
  const viewed =
    canReview && reviewStep !== undefined
      ? Math.max(firstStep, Math.min(reviewStep, index))
      : index;
  const reviewing = viewed < index;
  const saved = !s || completed ? result : undefined;
  const pose =
    viewed === 0
      ? s?.referencePosition
      : (s?.safePosition ?? saved?.observationPose);
  const boundary = s?.calibration?.boundary ?? saved?.verification?.boundary;
  const samples = s?.samples ?? saved?.verification?.auto?.samples.length;
  const reviewDetail =
    viewed === 1
      ? samples === undefined
        ? undefined
        : `${t('Samples')} · ${samples}`
      : viewed === 2
        ? boundary
          ? [
              [t('Hover'), boundary.hoverCorners && boundary.hoverEdges],
              [t('Contact'), boundary.contactCorners && boundary.contactEdges],
            ]
              .map(([label, passed]) => `${label} ${passed ? '✓' : '—'}`)
              .join(' · ')
          : undefined
        : pose
          ? ['x', 'y', 'z']
              .map(
                (axis) =>
                  `${axis.toUpperCase()} ${pose.positionMm[axis as 'x' | 'y' | 'z'].toFixed(2)} mm`,
              )
              .join(' · ')
          : undefined;
  const liveActions = completed ? (
    <>
      <Button
        disabled={busy || !readyToStart}
        onClick={onRestart ?? (() => start(controller.create))}
      >
        {t('Restart Calibration')}
      </Button>
      <Button type="primary" onClick={onReturn}>
        {t(completionLabel)}
      </Button>
    </>
  ) : !s ? (
    <Button
      type="primary"
      disabled={
        busy || (!checkBeforeStart && (!setup.mapping || !readyToStart))
      }
      onClick={() => start(controller.create)}
    >
      {t('Start automatic calibration')}
    </Button>
  ) : stage === 'positioning' ? (
    <Button
      type="primary"
      loading={busy}
      onClick={() => command('record-reference', true)}
    >
      {t('Record Reference Position')}
    </Button>
  ) : stage === 'ready' && !s.referencePosition ? (
    <Button
      type="primary"
      disabled={busy || !readyToCapture}
      onClick={() => command('position-reference', true)}
    >
      {t('Enter Drag Mode')}
    </Button>
  ) : stage === 'positioning-boundary' ? (
    <Button
      type="primary"
      loading={busy}
      onClick={() => command('record-boundary', true)}
    >
      {t('Record Camera Boundary')}
    </Button>
  ) : stage === 'ready' && !s.teachingId && s.cameraBoundaryPosition ? (
    <Button
      type="primary"
      disabled={busy || !confirmed}
      onClick={() => command('save-teaching', true)}
    >
      {t('Save Installation Teaching')}
    </Button>
  ) : stage === 'ready' ? (
    <Button
      type="primary"
      loading={busy}
      disabled={
        !checkBeforeStart &&
        (!confirmed || !s.phoneConnected || !readyToCapture)
      }
      onClick={() =>
        start(() =>
          controller.command(
            mode === 'slide' ? 'start-slide' : 'start-automatic',
            true,
          ),
        )
      }
    >
      {t('Start automatic calibration')}
    </Button>
  ) : stage === 'boundary-review' ? (
    <>
      <Button disabled={busy} onClick={() => command('restart', true)}>
        {t('Restart Calibration')}
      </Button>
      <Button
        type="primary"
        disabled={busy || !readyToCapture || !s.phoneConnected}
        onClick={() => command('verify-boundary', true)}
      >
        {t('Continue to boundary verification')}
      </Button>
    </>
  ) : stage === 'return-ready' ? (
    <Button
      type="primary"
      disabled={busy || !readyToCapture}
      onClick={() => command('position-safe', true)}
    >
      {t('Enter Drag Mode')}
    </Button>
  ) : stage === 'positioning-safe' ? (
    <Button
      type="primary"
      loading={busy}
      onClick={() => command('record-safe', true)}
    >
      {t('Record Safe Position')}
    </Button>
  ) : stage === 'review' ? (
    <Button
      type="primary"
      loading={busy}
      disabled={!saveConfirmed || !s.phoneConnected}
      onClick={() =>
        void controller
          .command('accept', true)
          .then(onActivated)
          .catch(() => undefined)
      }
    >
      {t('Save and Use')}
    </Button>
  ) : offerStandardRetry ? (
    <Button
      type="primary"
      disabled={busy || !readyToStart || !readyToCapture || !s.phoneConnected}
      onClick={() => {
        setMode('standard');
        start(() => controller.command('retry-standard', true));
      }}
    >
      {t('Confirm retry')}
    </Button>
  ) : ['cancelled', 'interrupted', 'capture-failed'].includes(stage ?? '') ? (
    <Button
      type="primary"
      disabled={busy || !readyToStart}
      onClick={() => start(() => controller.command('restart', true))}
    >
      {t('Restart Calibration')}
    </Button>
  ) : null;
  const actions = (
    <>
      {showSessionCancel &&
        s &&
        !completed &&
        !['cancelled', 'interrupted'].includes(stage ?? '') && (
          <Button
            type="primary"
            className="robot-cancel-calibration"
            danger
            disabled={busy}
            onClick={() => command('cancel')}
          >
            {t('Cancel Calibration')}
          </Button>
        )}

      {viewed > firstStep && (
        <Button
          className="robot-previous-step"
          disabled={!canReview}
          onClick={() => setReviewStep(viewed - 1)}
        >
          {t('Previous Step')}
        </Button>
      )}
      {reviewing ? (
        <Button
          onClick={() =>
            setReviewStep(viewed + 1 < index ? viewed + 1 : undefined)
          }
        >
          {t('Next')}
        </Button>
      ) : (
        liveActions
      )}
    </>
  );
  return (
    <div className="robot-web-calibration">
      <nav className="robot-web-phases" aria-label={t('Calibration progress')}>
        {steps.slice(firstStep).map((label, i) => (
          <span
            key={label}
            className={i + firstStep === viewed ? 'current' : ''}
          >
            {i + firstStep < index ? '✓' : i + 1} {t(label)}
          </span>
        ))}
      </nav>
      <div
        className={`robot-setup-task-layout${externalPreview ? ' has-external-preview' : ''}`}
      >
        <section className="robot-disclosure-body">
          <SetupNotice
            notice={
              error || s?.error
                ? {
                    tone: 'warning',
                    title: calibrationErrorText(error ?? s!.error!),
                  }
                : undefined
            }
          />
          {offerStandardRetry && (
            <Typography.Paragraph>
              {t('Retry in regular mode?')}
            </Typography.Paragraph>
          )}
          {stage === 'ready' &&
            s?.referencePosition &&
            !reviewing &&
            !(prepareFromTeaching && s.teachingId) && (
              <div>
                <Typography.Paragraph>
                  {t(
                    s.teachingId
                      ? 'Saved installation teaching is shared by screens on this camera.'
                      : 'Record the camera-side boundary once to enable automatic camera avoidance.',
                  )}
                </Typography.Paragraph>
                {!s.teachingId && !s.cameraBoundaryPosition && (
                  <Button
                    disabled={busy || !readyToCapture}
                    onClick={() => command('position-boundary', true)}
                  >
                    {t('Teach Camera Boundary')}
                  </Button>
                )}
                {s.teachingId && (
                  <Button
                    disabled={busy || !readyToCapture}
                    onClick={() => command('position-reference', true)}
                  >
                    {t('Reteach Installation')}
                  </Button>
                )}
                {s.cameraBoundaryPosition && !s.teachingId && (
                  <Checkbox
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  >
                    {t(
                      'The phone is horizontal, the stylus is vertical, and the full arm has camera clearance on the reference side of the boundary. There are no other obstacles.',
                    )}
                  </Checkbox>
                )}
              </div>
            )}
          {stage === 'positioning-boundary' && (
            <Typography.Paragraph>
              {t(
                'Move straight from the reference towards the camera and stop at a safe boundary. Leave clearance for the whole arm, then release it before recording.',
              )}
            </Typography.Paragraph>
          )}
          {stage === 'avoiding-camera' && (
            <Typography.Paragraph>
              {t('Moving to the camera-avoidance position')}
            </Typography.Paragraph>
          )}
          {reviewing ? (
            <>
              <Typography.Title level={4}>{t(steps[viewed])}</Typography.Title>
              <Typography.Paragraph>
                {reviewDetail ?? t('No measurement recorded for this step.')}
              </Typography.Paragraph>
            </>
          ) : (
            <>
              {!s && controls}
              {!(s?.phoneConnected ?? setup.phoneConnected) && !completed && (
                <Typography.Paragraph>
                  {t('Phone disconnected')}
                  {onConnectPhone && (
                    <Button onClick={onConnectPhone}>
                      {t('Connect Phone')}
                    </Button>
                  )}
                </Typography.Paragraph>
              )}
              {!setup.mapping && !s?.mapping && onCheckCamera && (
                <Button onClick={onCheckCamera}>
                  {t('Check Camera Mapping')}
                </Button>
              )}
              {(stage === 'positioning' ||
                (stage === 'ready' && !s?.referencePosition)) && (
                <Typography.Paragraph>
                  {t(
                    'Place the stylus 20–50 mm above the center of the screen. Release the robot and record the starting position. Recording does not move the robot.',
                  )}
                </Typography.Paragraph>
              )}
              {stage === 'ready' &&
                s?.referencePosition &&
                (s.teachingId || !s.cameraBoundaryPosition) && (
                  <>
                    <Radio.Group
                      value={mode}
                      onChange={(e) => {
                        setMode(e.target.value);
                        setConfirmed(false);
                      }}
                    >
                      <Radio.Button value="slide">{t('Fast')}</Radio.Button>
                      <Radio.Button value="standard">
                        {t('Regular')}
                      </Radio.Button>
                    </Radio.Group>
                    <Typography.Paragraph>
                      {t(
                        'Sampling and fitting are followed by automatic hover and contact boundary verification. Record the Safe Position afterwards, then review and save.',
                      )}
                    </Typography.Paragraph>
                    <Checkbox
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    >
                      {t(
                        mode === 'standard'
                          ? 'I confirm the setup and clear workspace for sampling and automatic boundary verification.'
                          : 'I confirm the screen is horizontal and secured, the setup is ready, and the workspace is clear for sampling and automatic boundary verification.',
                      )}
                    </Checkbox>
                  </>
                )}
              {s?.capture && <ExplorationProgress session={s} />}
              {activeMotion && (
                <Typography.Paragraph>
                  {t(
                    stage === 'collecting'
                      ? 'Collect calibration points'
                      : 'Boundary verification',
                  )}
                </Typography.Paragraph>
              )}
              {(stage === 'return-ready' || stage === 'positioning-safe') && (
                <Typography.Paragraph>
                  {t(
                    'Boundary verification is complete. Record a Safe Position clear of the screen and camera; release the robot before recording.',
                  )}
                </Typography.Paragraph>
              )}
              <ExplorationQualitySummary quality={quality} />
              {stage === 'review' && (
                <Checkbox
                  checked={saveConfirmed}
                  onChange={(e) => setSaveConfirmed(e.target.checked)}
                >
                  {t(
                    'I have reviewed the measurements and confirm the phone, camera and tool have not moved.',
                  )}
                </Checkbox>
              )}
              {completed && (
                <Typography.Paragraph>
                  {t('Calibration complete')}
                </Typography.Paragraph>
              )}
            </>
          )}
          <div className="robot-web-actions">{!footer && actions}</div>
        </section>
        {!externalPreview && (
          <section className="robot-setup-guide-card">
            {preview ?? (
              <Typography.Paragraph>
                {t('Camera preview unavailable')}
              </Typography.Paragraph>
            )}
          </section>
        )}
      </div>
      {footer &&
        createPortal(
          <div className="robot-web-actions">{actions}</div>,
          footer,
        )}
    </div>
  );
}
