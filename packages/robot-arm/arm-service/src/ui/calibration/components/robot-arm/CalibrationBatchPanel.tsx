import type {
  CalibrationBatchCommand,
  CalibrationBatchPlan,
  CalibrationBatchSamplingMode,
  CalibrationBatchState,
  WorkstationScreenState,
} from '@midscene/robotics-shared/assisted-contracts';
import {
  Alert,
  Button,
  Checkbox,
  Modal,
  Popconfirm,
  Radio,
  Space,
  Table,
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
import { calibrationErrorText, t } from '../../i18n';
import { batchAnnouncements, speakCalibration } from '../../voice/calibration';
import { CalibrationQualityWarnings } from './CalibrationQualityWarnings';

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
const visibilityPercent = (fraction: number | undefined) =>
  fraction === undefined ? '—' : `${Math.floor(fraction * 1000) / 10}%`;
function calibrationStatus(calibrated: boolean, cameraMappingChanged = false) {
  if (cameraMappingChanged)
    return {
      color: 'orange',
      label: t('Camera mapping changed · Recalibration required'),
    };
  return calibrated
    ? { color: 'green', label: t('Calibrated') }
    : { color: undefined, label: t('Not calibrated') };
}
/** Compact per-screen state for the detected-screen cards. */
function screenStatus(screen: WorkstationScreenState): {
  color?: string;
  label: string;
} {
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
      return calibrationStatus(
        screen.status === 'ready' && Boolean(screen.calibrationProfileId),
        screen.status === 'camera-mapping-changed',
      );
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
  const debug =
    batch?.cameraId === cameraId ? batch?.sharedParkingDebug : undefined;
  const debugging = debug?.status === 'running' || debug?.status === 'stopping';
  const [plan, setPlan] = useState<CalibrationBatchPlan>();
  const [previewPlan, setPreviewPlan] = useState<CalibrationBatchPlan>();
  const [deletedCalibrations, setDeletedCalibrations] = useState<string[]>([]);
  const [samplingMode, setSamplingMode] =
    useState<CalibrationBatchSamplingMode>('standard');
  const [horizontalConfirmed, setHorizontalConfirmed] = useState(false);
  const [manualAcceptance, setManualAcceptance] = useState(false);
  const [corridorConfirmed, setCorridorConfirmed] = useState(false);
  const latest = useRef({ onChanged, onActiveChange });
  latest.current = { onChanged, onActiveChange };
  const signature = useRef('');
  const mounted = useRef(true);
  const busyBatch = active(batch) || debugging;
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
        latest.current.onActiveChange?.(
          active(result) ||
            result?.sharedParkingDebug?.status === 'running' ||
            result?.sharedParkingDebug?.status === 'stopping',
        );
        const current = result?.items[result.currentIndex];
        const next = `${result?.id}:${current?.screenProfileId}:${current?.calibrationProfileId}:${result?.status}:${result?.sharedParkingDebug?.status}`;
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
      setSamplingMode('standard');
      setManualAcceptance(false);
      setCorridorConfirmed(false);
    });
  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        if (disabled || working || debugging || !cameraId) return;
        openPlan();
      },
    }),
    [disabled, working, debugging, cameraId],
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
        compliantSetupConfirmed: samplingMode === 'slide' ? true : undefined,
        samplingMode,
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
        (action === 'retry' && !parkingOnly) ||
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
  const parkingOnly = Boolean(
    batch?.usesSharedSafePosition &&
      batch.items.some((item) => item.status === 'completed') &&
      batch.items.every((item) =>
        ['completed', 'skipped'].includes(item.status),
      ),
  );
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
            disabled={working || debugging}
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
            {t(batch.samplingMode === 'slide' ? 'Fast' : 'Regular')} ·{' '}
            {t(
              parkingOnly && batch.status === 'failed'
                ? 'Screen calibration results saved'
                : (itemLabels[batch.status] ?? batch.status),
            )}
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
                    {calibrationErrorText(item.error)}
                  </Typography.Paragraph>
                )}
                {item.status === 'completed' && (
                  <CalibrationQualityWarnings
                    key={`${batch.id}:${item.runIds.at(-1) ?? ''}`}
                    warnings={item.qualityWarnings}
                    advisory
                    dismissible
                  />
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
          {parkingOnly && batch.status === 'running' && (
            <output>
              {t('Checking phone pages and finding the shared Safe Position')}
            </output>
          )}
          {batch.error &&
            !batch.items.some((item) => item.error === batch.error) && (
              <Typography.Paragraph type={parkingOnly ? 'warning' : 'danger'}>
                {parkingOnly && (
                  <>
                    <strong>{t('Shared Safe Position pending')}</strong>
                    <br />
                  </>
                )}
                {calibrationErrorText(batch.error)}
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
                    <>
                      {batch.usesSharedSafePosition && (
                        <Typography.Text>
                          {t(
                            'Teach one shared Safe Position clear of all screens and the space between them. Check clearance for the full arm.',
                          )}
                        </Typography.Text>
                      )}
                      <Button
                        disabled={working}
                        onClick={() => command('record-safe-position')}
                      >
                        {t(
                          batch.usesSharedSafePosition
                            ? 'Confirm and record shared Safe Position'
                            : 'Record current safe position',
                        )}
                      </Button>
                    </>
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
            {!debugging &&
              (!isActive || row?.status === 'awaiting-boundary-review') &&
              batch.status !== 'completed' && (
                <>
                  <Button
                    disabled={working || disabled}
                    onClick={() => command('retry')}
                  >
                    {t(parkingOnly ? 'Retry parking' : 'Retry This Screen')}
                  </Button>
                  {parkingOnly &&
                    !batch.sharedSafePositionVerified &&
                    ['failed', 'stopped'].includes(batch.status) && (
                      <Popconfirm
                        title={t('Confirm current shared Safe Position')}
                        description={t(
                          'Confirm the arm is stationary, clear of the camera and all screens, and does not block any screen in the live view.',
                        )}
                        okText={t('Confirm')}
                        cancelText={t('Cancel')}
                        onConfirm={() => command('confirm-shared-parking')}
                      >
                        <Button type="primary" disabled={working || disabled}>
                          {t('Confirm current shared Safe Position')}
                        </Button>
                      </Popconfirm>
                    )}
                  {!parkingOnly && (
                    <Button
                      disabled={working || disabled}
                      onClick={() => command('skip')}
                    >
                      {t('Skip This Screen')}
                    </Button>
                  )}
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
            {calibrationErrorText(error)}
          </Typography.Paragraph>
        )}
      <details>
        <summary>{t('Advanced debugging')}</summary>
        <Popconfirm
          title={t('Confirm the motion area is clear. The robot will move.')}
          okText={t('Start search')}
          cancelText={t('Cancel')}
          onConfirm={() => command('debug-shared-parking')}
        >
          <Button
            disabled={
              disabled ||
              working ||
              busyBatch ||
              !parkingOnly ||
              batch?.cameraId !== cameraId
            }
            size="small"
            type="link"
          >
            {t('Debug shared Safe Position search')}
          </Button>
        </Popconfirm>
        {debugging && (
          <Space wrap>
            <output>
              {t(
                debug.status === 'stopping'
                  ? 'Stopping'
                  : 'Checking phone pages and finding the shared Safe Position',
              )}
            </output>
            <Button
              danger
              size="small"
              disabled={debug.status === 'stopping'}
              onClick={() => command('stop')}
            >
              {t('Stop search')}
            </Button>
          </Space>
        )}
        {batch?.visibilityMissingScreens?.length ? (
          <Typography.Paragraph type="secondary">
            {t('Unverified screens in last Safe Position check')} ·{' '}
            {batch.visibilityMissingScreens.join(' · ')}
          </Typography.Paragraph>
        ) : null}
        {debug?.error && (
          <Alert type="error" message={calibrationErrorText(debug.error)} />
        )}
        {debug?.status === 'stopped' && <output>{t('Stopped')}</output>}
        {debug?.status === 'completed' && debug.pose && (
          <Typography.Paragraph type="success">
            {t('Found shared Safe Position: X {0} mm / Y {1} mm / Z {2} mm', [
              debug.pose.positionMm.x.toFixed(1),
              debug.pose.positionMm.y.toFixed(1),
              debug.pose.positionMm.z.toFixed(1),
            ])}
          </Typography.Paragraph>
        )}
        {debug && !debugging && batch?.status === 'completed' && (
          <Button
            disabled={working || disabled}
            onClick={() => command('retry')}
            size="small"
          >
            {t('Retry parking')}
          </Button>
        )}
        {debug?.visibility && !debugging && (
          <div aria-live="polite">
            <Typography.Text
              type={debug.visibility.clear ? 'success' : 'warning'}
            >
              {t(
                debug.visibility.clear
                  ? 'Screen visibility passed'
                  : 'Screen visibility did not pass',
              )}
            </Typography.Text>
            <Table
              size="small"
              rowKey="id"
              pagination={false}
              scroll={{ x: 'max-content' }}
              dataSource={debug.visibility.screens}
              columns={[
                {
                  title: t('Screen name'),
                  render: (_, screen) =>
                    screens.find(({ screenId }) => screenId === screen.id)
                      ?.name ?? screen.id,
                },
                {
                  title: t('Whole screen'),
                  dataIndex: 'visibleFraction',
                  render: visibilityPercent,
                },
                {
                  title: t('Screen interior'),
                  dataIndex: 'interiorVisibleFraction',
                  render: visibilityPercent,
                },
                {
                  title: t('Largest unresponsive region (samples)'),
                  dataIndex: 'largestUnresponsiveRegion',
                  render: (samples: number | undefined) => samples ?? '—',
                },
              ]}
            />
          </div>
        )}
      </details>
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
            {plan?.screens.map((screen) => {
              const status = calibrationStatus(
                screen.calibrated,
                screen.cameraMappingChanged,
              );
              return (
                <li key={screen.screenId}>
                  <Typography.Text strong={screen.startsHere}>
                    {screen.name}
                  </Typography.Text>{' '}
                  <Tag color={status.color}>{status.label}</Tag>
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
              );
            })}
          </ol>
          <Radio.Group
            aria-label={t('Sampling mode')}
            value={samplingMode}
            onChange={(event) => {
              setSamplingMode(event.target.value);
              setHorizontalConfirmed(false);
            }}
          >
            <Radio.Button value="standard">{t('Regular')}</Radio.Button>
            <Radio.Button value="slide">{t('Fast')}</Radio.Button>
          </Radio.Group>
          <Checkbox
            checked={horizontalConfirmed}
            onChange={(event) => setHorizontalConfirmed(event.target.checked)}
          >
            {t(
              samplingMode === 'slide'
                ? 'All screens are fixed horizontally and the tool has elastic compliance.'
                : 'All screens are secured; the measured plane allows limited tilt. The tool has elastic compliance.',
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
