import type {
  CalibrationBatchCommand,
  CalibrationBatchPlan,
  CalibrationBatchState,
  WorkstationScreenState,
} from '@midscene/arm-kit-shared/assisted-contracts';
import {
  Alert,
  Button,
  Checkbox,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { BatchClient as RobotArmApi } from '../../batch-client';
import { t } from '../../i18n';
import { batchAnnouncements, speakCalibration } from '../../voice/calibration';

const active = (batch: CalibrationBatchState | null | undefined) =>
  Boolean(batch && ['running', 'waiting', 'stopping'].includes(batch.status));
const itemLabels: Record<string, string> = {
  pending: 'Pending',
  preparing: 'Preparing screen',
  transferring: 'Transferring to screen',
  exploring: 'Exploring screen',
  'awaiting-mapping': 'Waiting for page mapping',
  'awaiting-placement': 'Waiting for stylus placement',
  'awaiting-acceptance': 'Waiting for calibration acceptance',
  'awaiting-boundary-review': 'Review calibration measurements',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
  skipped: 'Skipped',
  running: 'Running',
  waiting: 'Waiting',
  stopping: 'Stopping',
};
const describeCause = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);
/** Compact per-screen state for the detected-screen cards. */
function screenStatus(screen: WorkstationScreenState): {
  color?: string;
  label: string;
} {
  if (screen.status === 'ready' && screen.calibrationProfileId)
    return { color: 'green', label: t('Calibrated') };
  switch (screen.status) {
    case 'unavailable':
      return { color: 'red', label: t('Unavailable') };
    case 'mapping-required':
      return { color: 'orange', label: t('Page mapping required') };
    case 'acceptance-required':
      return { color: 'orange', label: t('Acceptance required') };
    case 'unconfigured':
      return { label: t('Not configured') };
    default:
      return { label: t('Not calibrated') };
  }
}

export interface CalibrationBatchPanelHandle {
  /** Opens the batch confirmation for the current camera. */
  open: () => void;
}

/**
 * Multi-screen automatic calibration.
 *
 * The section is informational plus the running queue: the primary action lives
 * in the workspace footer, and the confirmation dialog carries the safety
 * acknowledgements. The server plans the screens, the order and the transfer
 * corridor.
 */
export const CalibrationBatchPanel = forwardRef<
  CalibrationBatchPanelHandle,
  {
    api: RobotArmApi;
    cameraId?: string;
    /** Screens of the selected camera, already fetched by the workspace. */
    screens: readonly WorkstationScreenState[];
    disabled: boolean;
    onChanged?: () => void | Promise<void>;
    onActiveChange?: (active: boolean) => void;
  }
>(function CalibrationBatchPanel(
  { api, cameraId, screens, disabled, onChanged, onActiveChange },
  ref,
) {
  const [batch, setBatch] = useState<CalibrationBatchState | null>();
  const [startedHere, setStartedHere] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [plan, setPlan] = useState<CalibrationBatchPlan>();
  const [previewPlan, setPreviewPlan] = useState<CalibrationBatchPlan>();
  const [deletedCalibrations, setDeletedCalibrations] = useState<string[]>([]);
  const [horizontalConfirmed, setHorizontalConfirmed] = useState(false);
  const [manualAcceptance, setManualAcceptance] = useState(false);
  const [corridorConfirmed, setCorridorConfirmed] = useState(false);
  const latest = useRef({ onChanged, onActiveChange });
  latest.current = { onChanged, onActiveChange };
  const signature = useRef('');
  const mounted = useRef(true);
  const busyBatch = Boolean(batch && active(batch));
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let pending = false;
    const announce = batchAnnouncements();
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api.calibrationBatch();
        if (disposed) return;
        announce(result);
        setBatch(result);
        latest.current.onActiveChange?.(active(result));
        const current = result?.items[result.currentIndex];
        const next = `${result?.id}:${current?.screenProfileId}:${current?.calibrationProfileId}:${result?.status}`;
        if (signature.current !== next) {
          signature.current = next;
          await latest.current.onChanged?.();
        }
      } catch (cause) {
        if (!disposed) setError(describeCause(cause));
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      disposed = true;
      mounted.current = false;
      clearInterval(timer);
    };
  }, [api]);
  /*
   * The order is what tells the operator which screen the taught reference
   * belongs to. Read the same plan the start dialog uses, but never while a
   * batch owns the workstation.
   */
  useEffect(() => {
    if (
      !cameraId ||
      busyBatch ||
      typeof api.calibrationBatchPlan !== 'function'
    )
      return;
    let disposed = false;
    const load = () => {
      void api.calibrationBatchPlan(cameraId).then(
        (next) => {
          if (!disposed) setPreviewPlan(next);
        },
        () => undefined,
      );
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [api, cameraId, busyBatch]);
  const perform = async (work: () => Promise<unknown>) => {
    setWorking(true);
    setError(undefined);
    try {
      await work();
      if (mounted.current) {
        setBatch(await api.calibrationBatch());
        await latest.current.onChanged?.();
      }
    } catch (cause) {
      if (mounted.current) setError(describeCause(cause));
    } finally {
      if (mounted.current) setWorking(false);
    }
  };
  const openPlan = () =>
    void perform(async () => {
      if (!cameraId) throw new Error(t('Select the main camera first.'));
      const next = await api.calibrationBatchPlan(cameraId);
      if (!mounted.current) return;
      setPlan(next);
      speakCalibration('batchClearance', 2);
      setHorizontalConfirmed(false);
      setManualAcceptance(false);
      setCorridorConfirmed(false);
    });
  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (disabled || working || !cameraId) return;
        openPlan();
      },
    }),
    [disabled, working, cameraId],
  );
  const start = () =>
    void perform(async () => {
      if (!plan || !cameraId)
        throw new Error(
          t('Review the calibration plan again before starting.'),
        );
      speakCalibration('batchNext', 2);
      await api.startCalibrationBatch({
        planVersion: plan.version,
        cameraId,
        auto: true,
        horizontalConfirmed: true,
        ...(manualAcceptance ? { acceptance: 'manual' as const } : {}),
        ...(plan.transfer ? { corridorConfirmed: true as const } : {}),
      });
      setPlan(undefined);
      setStartedHere(true);
    });
  const command = (action: CalibrationBatchCommand['action']) => {
    if (!batch) return;
    void perform(() => {
      if (action === 'enter-drag') speakCalibration('beforeDrag', 2);
      if (
        action === 'continue' &&
        batch.items[batch.currentIndex]?.status === 'awaiting-boundary-review'
      )
        speakCalibration('autoVerifying', 2);
      else if (
        action === 'retry' ||
        action === 'skip' ||
        (action === 'continue' &&
          batch.items[batch.currentIndex]?.status === 'awaiting-placement')
      )
        speakCalibration('batchNext', 2);
      return api.calibrationBatchCommand(batch.id, {
        action,
        revision: batch.revision,
      });
    });
  };
  const row = batch?.items[batch.currentIndex];
  const isActive = active(batch);
  const showQueue = Boolean(
    batch &&
      (isActive || startedHere || ['failed', 'stopped'].includes(batch.status)),
  );
  const screenList = (
    <div className="robot-calibration-screen-list">
      {screens.map((screen) => {
        const calibrationProfileId = screen.calibrationProfileId;
        const deleted =
          Boolean(calibrationProfileId) &&
          deletedCalibrations.includes(calibrationProfileId!);
        const effective = deleted
          ? {
              ...screen,
              calibrationProfileId: undefined,
              expectedCenterMm: undefined,
              expectedSource: undefined,
            }
          : screen;
        const status = screenStatus(effective);
        return (
          <div className="robot-calibration-screen" key={screen.screenId}>
            <div className="robot-calibration-screen-heading">
              <Typography.Text strong>{screen.name}</Typography.Text>
              <Tag color={status.color}>{status.label}</Tag>
            </div>
            {effective.expectedCenterMm && (
              <details>
                <summary>{t('Start Position')}</summary>
                <Typography.Text type="secondary">
                  {t('Expected stylus start: X {0} mm / Y {1} mm', [
                    effective.expectedCenterMm.x.toFixed(1),
                    effective.expectedCenterMm.y.toFixed(1),
                  ])}
                  {effective.expectedSource === 'estimate'
                    ? ` · ${t('Estimate')}`
                    : ''}
                </Typography.Text>
              </details>
            )}
            {!deleted &&
              calibrationProfileId &&
              !busyBatch &&
              !working &&
              !disabled && (
                <Popconfirm
                  cancelText={t('Cancel')}
                  description={t(
                    'The record stays in history but stops being active; the screen returns to uncalibrated.',
                  )}
                  okButtonProps={{ danger: true }}
                  okText={t('Delete')}
                  onConfirm={() =>
                    void perform(async () => {
                      await api.deleteCalibration(calibrationProfileId);
                      setDeletedCalibrations((previous) => [
                        ...previous,
                        calibrationProfileId,
                      ]);
                      await latest.current.onChanged?.();
                    })
                  }
                  title={t('Delete this calibration?')}
                >
                  <Button danger size="small" type="link">
                    {t('Delete calibration')}
                  </Button>
                </Popconfirm>
              )}
          </div>
        );
      })}
    </div>
  );
  const needsCorridor = Boolean(plan?.transfer);
  const readyToStart =
    horizontalConfirmed && (!needsCorridor || corridorConfirmed);
  return (
    <section
      className="robot-calibration-batch"
      aria-label={t('Multi-screen calibration')}
    >
      <div className="robot-calibration-batch-summary">
        <Typography.Text>
          {t('{0} screens detected', [String(screens.length)])}
        </Typography.Text>
        {batch && !isActive && (
          <Button
            disabled={working}
            onClick={() =>
              void perform(async () => {
                await api.clearCalibrationBatches();
                setStartedHere(false);
              })
            }
            size="small"
            type="link"
          >
            {t('Clear batch record')}
          </Button>
        )}
      </div>
      {!showQueue && previewPlan && previewPlan.screens.length > 1 && (
        <Typography.Text type="secondary">
          {t('Calibration order: {0}', [
            previewPlan.screens.map((screen) => screen.name).join(' → '),
          ])}
        </Typography.Text>
      )}
      {showQueue ? (
        <details>
          <summary>{t('Screen Details')}</summary>
          {screenList}
        </details>
      ) : (
        screenList
      )}
      {batch && showQueue && (
        <div className="robot-calibration-batch-queue">
          <Typography.Text strong>
            {t('Calibration batch')} ·{' '}
            {t(itemLabels[batch.status] ?? batch.status)}
          </Typography.Text>
          <ol>
            {batch.items.map((item, index) => (
              <li key={item.screenId}>
                <Typography.Text strong={index === batch.currentIndex}>
                  {item.name}
                </Typography.Text>{' '}
                <Tag>{t(itemLabels[item.status] ?? item.status)}</Tag>
                {index === batch.currentIndex &&
                  item.status === 'exploring' &&
                  item.progress && (
                    <div>
                      {t(item.progress.message ?? item.progress.phase)}
                      {item.progress.total > 1 &&
                        ` ${item.progress.index}/${item.progress.total}`}
                    </div>
                  )}
                {index === batch.currentIndex &&
                  item.status.startsWith('awaiting-') &&
                  item.note && <div>{t(item.note)}</div>}
                {item.error && (
                  <Typography.Paragraph type="danger">
                    {t(item.error)}
                  </Typography.Paragraph>
                )}
                {item.runIds.length > 0 && (
                  <details>
                    <summary>{t('Run history')}</summary>
                    <div>{t('Attempts: {0}', [String(item.attempts)])}</div>
                    {item.note && !item.status.startsWith('awaiting-') && (
                      <div>{t(item.note)}</div>
                    )}
                    {item.runIds.map((id) => (
                      <div key={id}>
                        <code>{id}</code>
                      </div>
                    ))}
                  </details>
                )}
              </li>
            ))}
          </ol>
          {batch.error &&
            !batch.items.some((item) => item.error === batch.error) && (
              <Typography.Paragraph type="danger">
                {t(batch.error)}
              </Typography.Paragraph>
            )}
          <Space wrap>
            {isActive && (
              <Button danger onClick={() => command('stop')}>
                {t('Stop batch')}
              </Button>
            )}
            {batch.status === 'waiting' &&
              row &&
              [
                'awaiting-mapping',
                'awaiting-placement',
                'awaiting-boundary-review',
              ].includes(row.status) && (
                <Button
                  type="primary"
                  disabled={working}
                  onClick={() => command('continue')}
                >
                  {t(
                    row.status === 'awaiting-boundary-review'
                      ? 'Continue to boundary verification'
                      : row.status === 'awaiting-placement'
                        ? 'Confirm Placement'
                        : 'Continue this screen',
                  )}
                </Button>
              )}
            {batch.status === 'waiting' &&
              row &&
              ['awaiting-placement', 'awaiting-acceptance'].includes(
                row.status,
              ) && (
                <>
                  <Button
                    disabled={working}
                    onClick={() => command('enter-drag')}
                  >
                    {t('Enter Drag Mode')}
                  </Button>
                  <Button
                    disabled={working}
                    onClick={() => command('exit-drag')}
                  >
                    {t('Exit Drag Mode')}
                  </Button>
                </>
              )}
            {batch.status === 'waiting' &&
              row?.status === 'awaiting-acceptance' && (
                <>
                  {row.progress?.phase === 'awaiting-safe-position' && (
                    <Button
                      disabled={working}
                      onClick={() => command('record-safe-position')}
                    >
                      {t('Record current safe position')}
                    </Button>
                  )}
                  <Button
                    type="primary"
                    disabled={
                      working ||
                      row.progress?.phase === 'awaiting-safe-position'
                    }
                    onClick={() => command('accept')}
                  >
                    {t('Accept and save this screen')}
                  </Button>
                </>
              )}
            {(!isActive || row?.status === 'awaiting-boundary-review') &&
              batch.status !== 'completed' && (
                <>
                  <Button
                    disabled={working || disabled}
                    onClick={() => command('retry')}
                  >
                    {t('Retry This Screen')}
                  </Button>
                  <Button
                    disabled={working || disabled}
                    onClick={() => command('skip')}
                  >
                    {t('Skip This Screen')}
                  </Button>
                </>
              )}
          </Space>
        </div>
      )}
      {error &&
        !(
          showQueue &&
          (batch?.error === error ||
            batch?.items.some((item) => item.error === error))
        ) && (
          <Typography.Paragraph type="danger" role="alert">
            {t(error)}
          </Typography.Paragraph>
        )}
      <Modal
        destroyOnClose
        footer={
          <Space>
            <Button onClick={() => setPlan(undefined)}>{t('Cancel')}</Button>
            <Button
              type="primary"
              disabled={!readyToStart || working}
              loading={working}
              onClick={start}
            >
              {t('Start automatic calibration')}
            </Button>
          </Space>
        }
        onCancel={() => setPlan(undefined)}
        open={Boolean(plan)}
        title={t('Start automatic calibration')}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text>{t('Calibration Order')}</Typography.Text>
          <ol>
            {plan?.screens.map((screen) => (
              <li key={screen.screenId}>
                <Typography.Text strong={screen.startsHere}>
                  {screen.name}
                </Typography.Text>{' '}
                <Tag color={screen.calibrated ? 'green' : undefined}>
                  {t(screen.calibrated ? 'Calibrated' : 'Not calibrated')}
                </Tag>
                {screen.startsHere && (
                  <Tag color="blue">{t('Starts here')}</Tag>
                )}
                {screen.expectedCenterMm && (
                  <div>
                    <Typography.Text type="secondary">
                      {t('Expected stylus start: X {0} mm / Y {1} mm', [
                        screen.expectedCenterMm.x.toFixed(1),
                        screen.expectedCenterMm.y.toFixed(1),
                      ])}
                    </Typography.Text>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <Checkbox
            checked={horizontalConfirmed}
            onChange={(event) => setHorizontalConfirmed(event.target.checked)}
          >
            {t(
              'All screens are secured; the measured plane allows limited tilt. The tool has elastic compliance.',
            )}
          </Checkbox>
          <Checkbox
            checked={manualAcceptance}
            onChange={(event) => setManualAcceptance(event.target.checked)}
          >
            {t('Pause for acceptance on each screen')}
          </Checkbox>
          {plan?.transfer && (
            <>
              <Alert
                showIcon
                message={t(
                  'Check clearance for the full arm, cables and fixtures.',
                )}
                type="warning"
              />
              <ul>
                <li>
                  {t('Global travel tip Z (mm)')}: {plan.transfer.travelTipZMm}
                </li>
                <li>
                  {t('Highest obstacle Z (mm)')}:{' '}
                  {plan.transfer.highestObstacleZMm}
                </li>
                <li>
                  {t('Transfer clearance (mm)')}: {plan.transfer.clearanceMm}
                </li>
                <li>
                  {t('Transfer corridor (mm)')}: X {plan.transfer.corridor.minX}{' '}
                  … {plan.transfer.corridor.maxX}, Y{' '}
                  {plan.transfer.corridor.minY} … {plan.transfer.corridor.maxY}
                </li>
                {plan.transfer.waypoints.length > 0 && (
                  <li>
                    {t('Transfer waypoints')}:{' '}
                    {plan.transfer.waypoints
                      .map((point) => `${point.x},${point.y}`)
                      .join(' · ')}
                  </li>
                )}
              </ul>
              <Checkbox
                checked={corridorConfirmed}
                onChange={(event) => setCorridorConfirmed(event.target.checked)}
              >
                {t(
                  'I have checked the full arm swept corridor and the measured global clearance.',
                )}
              </Checkbox>
            </>
          )}
        </Space>
      </Modal>
    </section>
  );
});
