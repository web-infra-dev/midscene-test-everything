import { robotVoice } from '@midscene/arm-calibration-ui';
import {
  Alert,
  Badge,
  Button,
  Drawer,
  Modal,
  Space,
  Tag,
  Typography,
} from 'antd';
import {
  Bot,
  OctagonAlert,
  Play,
  Power,
  PowerOff,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useConnection } from '../../connection';
import { useViews } from '../../extensions';
import { t, useLanguage } from '../../i18n';
import type {
  ControllerStateSample,
  EffectiveCapabilities,
  RuntimeState,
  ToolProfile,
} from '../../robot-arm-api';

import { JointGuide } from './JointGuide';
import './RobotStatusBar.less';

type Action =
  | 'enable'
  | 'disable'
  | 'clearFaults'
  | 'recover'
  | 'resume'
  | 'emergencyStop'
  | 'payload';
interface Snapshot {
  session: string;
  state: RuntimeState;
  capabilities: EffectiveCapabilities;
  tool?: {
    toolProfileId: string;
    toolRevision: number;
    name: string;
    payload: ToolProfile['payload'];
  };
  controller?: ControllerStateSample;
  controllerError?: string;
  joints?: NonNullable<NonNullable<RuntimeState['state']['status']>['joints']>;
  queriedAt: string;
}
const labels: Record<Action, string> = {
  enable: 'Enable',
  disable: 'Disable',
  clearFaults: 'Clear Faults',
  resume: 'Resume',
  recover: 'Check Recovery',
  emergencyStop: 'Emergency Stop',
  payload: 'Apply Payload',
};
export function RobotStatusBar({
  cameraId,
  onConfigure,
  settings,
  preparing = false,
}: {
  cameraId?: string;
  onConfigure: () => void;
  settings?: ReactNode;
  preparing?: boolean;
}) {
  const {
    JointView,
    faultTitle: robotFaultTitle = (fault) =>
      fault.affected && 'joint' in fault.affected
        ? `J${fault.affected.joint} · ${fault.code}`
        : fault.code.toString(),
    faultText: robotFaultText = (fault) => ({
      description:
        (zh && fault.description?.zh) || fault.description?.en || fault.message,
      solution: (zh && fault.solution?.zh) || fault.solution?.en,
    }),
  } = useViews();
  const name = useConnection((state) => state.adapter?.name);
  const language = useLanguage();
  const zh = language === 'zh';
  const [data, setData] = useState<Snapshot>();
  const [queryError, setQueryError] = useState<string>();
  const [commandError, setCommandError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<Action>();
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef(false);
  const confirmation = useRef<Snapshot>();
  const choose = (action: Action) => {
    confirmation.current = data;
    setCommandError(undefined);
    setConfirm(action);
  };
  const confirmationChanged = Boolean(
    confirm &&
      (confirmation.current?.session !== data?.session ||
        confirmation.current?.tool?.toolProfileId !==
          data?.tool?.toolProfileId ||
        confirmation.current?.tool?.toolRevision !== data?.tool?.toolRevision ||
        confirmation.current?.state.state.enabled !==
          data?.state.state.enabled),
  );
  const { controlPending, controlError, recover } = useConnection();
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    const read = async () => {
      try {
        const response = await fetch(
          `/api/arm/status-panel?cameraId=${encodeURIComponent(cameraId ?? '')}&details=${open}`,
          {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(6000)]),
          },
        );
        const value = await response.json();
        if (!response.ok)
          throw new Error(
            value.error?.message ?? value.error ?? `HTTP ${response.status}`,
          );
        if (active) {
          setData(value);
          setQueryError(undefined);
        }
      } catch (error) {
        if (active) setQueryError(String(error));
      } finally {
        if (active) timer = setTimeout(() => void read(), open ? 1000 : 2000);
      }
    };
    void read();
    return () => {
      active = false;
      abort.abort();
      clearTimeout(timer);
    };
  }, [cameraId, open, refresh]);
  const state = data?.state.state;
  const capabilities = data?.capabilities;
  const stale =
    !data ||
    Boolean(queryError) ||
    !state?.status ||
    state.status.quality.stale;
  const connected = Boolean(state?.connected);
  const locked =
    busy ||
    Boolean(controlPending) ||
    stale ||
    !connected ||
    Boolean(
      state?.moving ||
        state?.dragMode ||
        data?.state.operation?.status === 'running',
    );
  const faults = state?.faults ?? [];
  const paused = Boolean(state?.paused || data?.state.softwarePaused);
  const has = (id: string) => capabilities?.controls.includes(id);
  const enableBlocked =
    locked ||
    !data?.tool?.payload ||
    Boolean(faults.length || paused || data?.state.recoveryRequired);
  const execute = async (action: Action, expected = data) => {
    if (pending.current && action !== 'emergencyStop') return;
    if (!expected) return;
    pending.current = true;
    setBusy(true);
    setCommandError(undefined);
    try {
      if (action === 'recover') {
        if (useConnection.getState().setupSession !== expected.session)
          throw new Error(
            t(
              'Robot state changed. Close this dialog and confirm the current operation again.',
            ),
          );
        await recover();
        const error = useConnection.getState().controlError;
        if (error) throw new Error(error);
        setConfirm(undefined);
        return;
      }
      if (action === 'enable') robotVoice.notify('enabling', 1);
      if (action === 'payload') robotVoice.notify('payload', 1);
      const response = await fetch('/api/arm/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          session: expected.session,
          confirmed: true,
          cameraId,
          toolProfileId: expected.tool?.toolProfileId,
          toolRevision: expected.tool?.toolRevision,
        }),
      });
      const value = await response.json();
      if (!response.ok)
        throw new Error(
          value.error?.message ?? value.error ?? `HTTP ${response.status}`,
        );
      const event = {
        enable: 'enabled',
        disable: 'disabled',
        clearFaults: 'clearFaults',
        resume: 'resuming',
        emergencyStop: 'emergencySent',
        payload: 'payloadDone',
      } as const;
      robotVoice.notify(event[action], action === 'emergencyStop' ? 3 : 1);
      setConfirm(undefined);
    } catch (error) {
      robotVoice.notify(
        action === 'emergencyStop' ? 'emergencyFailed' : 'failed',
        3,
      );
      setCommandError(String(error));
    } finally {
      pending.current = false;
      setBusy(false);
      setRefresh((value) => value + 1);
      void useConnection.getState().check();
    }
  };
  const confirms: Partial<Record<Action, string>> = {
    enable: 'Enable this arm? Keep people clear of its workspace.',
    clearFaults: 'Clear faults without enabling or moving?',
    recover:
      'Check recovery while the robot is stationary and fault-free. This does not enable or move the robot.',
    resume: 'Continue the controller? Interrupted tasks will not be replayed.',
    disable: 'Disable the stationary robot?',
    payload: 'Apply the saved tool payload?',
  };
  const errors = (
    <Space
      className="robot-errors-content"
      direction="vertical"
      size="middle"
      style={{ width: '100%' }}
    >
      {queryError && (
        <Alert
          type="error"
          showIcon
          message={t('Error query failed')}
          description={queryError}
        />
      )}
      {stale && <Alert type="warning" message={t('State unavailable')} />}
      <Typography.Title level={5}>{t('Controller Errors')}</Typography.Title>
      {!faults.length ? (
        <Alert
          type={stale ? 'info' : 'success'}
          message={t(
            stale
              ? 'Current controller errors have not been confirmed.'
              : 'No controller errors reported.',
          )}
        />
      ) : (
        faults.map((fault, index) => {
          const text = robotFaultText(fault);
          return (
            <Alert
              key={`${fault.code}:${index}`}
              className="robot-error-item"
              type={fault.severity === 'warning' ? 'warning' : 'error'}
              showIcon
              message={
                <span className="robot-error-title">
                  {robotFaultTitle(fault)}
                  {typeof fault.level === 'number' && (
                    <Tag>{t('Level {0}', [fault.level])}</Tag>
                  )}
                </span>
              }
              description={
                <div className="robot-error-item-copy">
                  <p>{text.description}</p>
                  {text.solution && (
                    <p className="robot-error-item-remedy">
                      {t('Remedy: {0}', [text.solution])}
                    </p>
                  )}
                </div>
              }
            />
          );
        })
      )}
      {has('control.clear-faults') && faults.length > 0 && (
        <Button
          danger
          type="primary"
          block
          disabled={locked || !faults.length}
          onClick={() => {
            setCommandError(undefined);
            choose('clearFaults');
          }}
        >
          {t('Clear Faults')}
        </Button>
      )}
      {data?.controllerError && (
        <Alert
          type="warning"
          message={t('Raw controller state could not be read.')}
          description={data.controllerError}
        />
      )}
      {JointView && data?.controller ? (
        <JointView
          sample={data.controller}
          stale={
            stale ||
            Boolean(data.controllerError) ||
            Date.now() - Date.parse(data.controller.receivedAt) > 2500
          }
          kinematics={capabilities?.kinematics}
        />
      ) : (
        capabilities?.kinematics && (
          <JointGuide
            kinematics={capabilities.kinematics}
            sample={data?.joints}
            faults={faults}
            stale={stale}
          />
        )
      )}
      {data?.queriedAt && (
        <Typography.Text type="secondary">
          {t('Last queried: {0}', [
            new Date(data.queriedAt).toLocaleTimeString(
              zh ? 'zh-CN' : 'en-GB',
              { hour12: false },
            ),
          ])}
        </Typography.Text>
      )}
      {data?.state.operation?.error && (
        <Alert
          type="warning"
          message={t('Operation / Connection Errors')}
          description={data.state.operation.error}
        />
      )}
      {commandError && <Alert type="error" message={commandError} />}
      <details>
        <summary>{t('Raw Error Details')}</summary>
        <pre className="robot-arm-error-json">
          {JSON.stringify(
            {
              faults,
              operation: data?.state.operation,
              controller: data?.controller,
              error: commandError,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </Space>
  );
  return (
    <>
      <fieldset
        className="robot-arm-controls robot-status-bar"
        aria-label={t('Robot Operating Controls')}
      >
        <div className="robot-status-bar-identity">
          <Bot size={18} />
          <strong>{name}</strong>
          <Tag
            color={
              stale
                ? 'default'
                : faults.length
                  ? 'error'
                  : state?.moving
                    ? 'processing'
                    : state?.enabled
                      ? 'success'
                      : 'default'
            }
          >
            {stale
              ? t('State unavailable')
              : faults.length
                ? zh
                  ? '有报警'
                  : 'Fault'
                : paused
                  ? zh
                    ? '已暂停'
                    : 'Paused'
                  : state?.moving
                    ? zh
                      ? '运动中'
                      : 'Moving'
                    : state?.enabled
                      ? t('Enabled')
                      : t('Disabled')}
          </Tag>
        </div>
        <Space wrap className="robot-status-main-actions">
          {(has('control.enable') ||
            has('control.enable-with-payload') ||
            has('control.disable')) && (
            <Button
              icon={
                state?.enabled ? <PowerOff size={16} /> : <Power size={16} />
              }
              disabled={
                state?.enabled
                  ? locked || !has('control.disable')
                  : enableBlocked
              }
              onClick={() => {
                setCommandError(undefined);
                choose(state?.enabled ? 'disable' : 'enable');
              }}
            >
              {t(state?.enabled ? 'Disable' : 'Enable')}
            </Button>
          )}
          {has('control.pause') && paused && (
            <Button
              icon={<Play size={16} />}
              disabled={locked || Boolean(faults.length)}
              onClick={() => choose('resume')}
            >
              {zh ? '继续' : 'Resume'}
            </Button>
          )}
          {(data?.state.recoveryRequired || controlError) && !paused && (
            <Button
              disabled={locked || Boolean(faults.length)}
              onClick={() => choose('recover')}
            >
              {t('Check Recovery')}
            </Button>
          )}
          {settings}
          <Badge count={faults.length}>
            <Button
              icon={<TriangleAlert size={16} />}
              onClick={() => setOpen(true)}
            >
              {t('Robot Errors')}
            </Button>
          </Badge>
          {has('control.emergency-stop') && (
            <Button
              danger
              type="primary"
              icon={<OctagonAlert size={16} />}
              disabled={!connected}
              onClick={() => void execute('emergencyStop')}
            >
              {t('Emergency Stop')}
            </Button>
          )}
        </Space>
        {!data?.tool && !preparing && (
          <Typography.Text className="robot-tool-status" type="secondary">
            {data?.tool
              ? `${data.tool.name} · ${zh ? '负载状态' : 'Payload'}: ${zh ? { 'not-required': '无需配置', missing: '未配置', pending: '待应用', applied: '已应用', unconfirmed: '未确认', applying: '应用中' }[data.state.payloadApplication?.status ?? 'unconfirmed'] : (data.state.payloadApplication?.status ?? 'unknown')}`
              : zh
                ? '请在所选设备的标定界面保存工具和负载配置后使能。'
                : 'Save the selected device tool and payload in calibration before enabling.'}
          </Typography.Text>
        )}
        <Space>
          {!data?.tool && !preparing && (
            <Button size="small" disabled={!cameraId} onClick={onConfigure}>
              {zh ? '配置工具' : 'Configure tool'}
            </Button>
          )}
          {has('control.apply-payload') && state?.enabled && (
            <Button
              size="small"
              disabled={enableBlocked}
              onClick={() => choose('payload')}
            >
              {zh ? '同步工具负载' : 'Apply tool payload'}
            </Button>
          )}
        </Space>
      </fieldset>
      <Drawer
        rootClassName="robot-drawer"
        width={520}
        open={open}
        onClose={() => setOpen(false)}
        title={t('Robot Errors')}
        extra={
          <Button
            type="text"
            aria-label={t('Refresh')}
            title={t('Refresh')}
            icon={<RefreshCw size={16} />}
            onClick={() => setRefresh((value) => value + 1)}
          />
        }
      >
        {errors}
      </Drawer>
      <Modal
        open={Boolean(confirm)}
        title={confirm ? t(labels[confirm]) : ''}
        confirmLoading={busy}
        okButtonProps={{ disabled: locked || confirmationChanged }}
        onCancel={() => {
          if (!busy) setConfirm(undefined);
        }}
        onOk={() => {
          if (confirm && !confirmationChanged)
            void execute(confirm, confirmation.current);
        }}
      >
        <p>{confirm ? t(confirms[confirm] ?? labels[confirm]) : ''}</p>
        {(confirm === 'enable' || confirm === 'payload') && (
          <>
            <p>{data?.tool?.name}</p>
            <p>
              {zh ? '负载质量' : 'Payload mass'}:{' '}
              {confirmation.current?.tool?.payload?.massKg} kg
            </p>
            {confirmation.current?.tool?.payload?.inertiaKgM2 !== undefined && (
              <p>
                {zh ? '转动惯量' : 'Inertia'}:{' '}
                {confirmation.current.tool.payload.inertiaKgM2} kg·m²
              </p>
            )}
          </>
        )}
        {confirmationChanged && (
          <Alert
            type="warning"
            message={t(
              'Robot state changed. Close this dialog and confirm the current operation again.',
            )}
          />
        )}
        {commandError && <Alert type="error" message={commandError} />}
      </Modal>
    </>
  );
}
