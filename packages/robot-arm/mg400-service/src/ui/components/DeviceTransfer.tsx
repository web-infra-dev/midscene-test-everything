import {
  Alert,
  Button,
  Checkbox,
  InputNumber,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { ArrowDown, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { CameraEntry } from '../cameras';
import { useT } from '../i18n';
import { createTransferStore } from '../transfers';
import './DeviceTransfer.less';

export function DeviceTransfer({
  id,
  cameras,
  initialTargetId,
  onClose,
}: {
  id: string;
  cameras: CameraEntry[];
  initialTargetId?: string;
  onClose(): void;
}) {
  const t = useT();
  const [useStore] = useState(() => createTransferStore(id));
  const state = useStore();
  const prefill = useRef(initialTargetId);
  useEffect(() => {
    void useStore.getState().load();
    return () => useStore.getState().dispose();
  }, [useStore]);
  useEffect(() => {
    const target = prefill.current;
    if (
      !target ||
      !state.source ||
      state.targetId === target ||
      !cameras.some((camera) => camera.id === target)
    )
      return;
    prefill.current = undefined;
    void state.select(target);
  }, [cameras, state.select, state.source, state.targetId]);
  const route = state.source?.routes.find(
    (entry) => entry.toCalibrationId === state.target?.calibration.id,
  );
  const knownErrors: Record<string, Parameters<typeof t>[0]> = {
    CALIBRATION_REQUIRED: 'transferNeedsCalibration',
    EXECUTION_CONTEXT_CHANGED: 'transferNeedsReload',
    TRANSFER_STALE: 'transferStale',
    WAYPOINT_REQUIRED: 'transferWaypointRequired',
    UNSAFE_OBSERVATION: 'transferUnsafe',
    TOOL_PAYLOAD_NOT_APPLIED: 'transferPayload',
  };
  const endpoint = (
    name: string,
    pose?: { positionMm: { x: number; y: number; z: number } },
  ) => (
    <div className="transfer-endpoint">
      <Typography.Text strong>{name}</Typography.Text>
      <Typography.Text type="secondary">
        {pose
          ? `X ${pose.positionMm.x.toFixed(2)} · Y ${pose.positionMm.y.toFixed(2)} · Z ${pose.positionMm.z.toFixed(2)} mm`
          : t('transferNeedsCalibration')}
      </Typography.Text>
    </div>
  );
  return (
    <Modal
      open
      title={t('transferTitle')}
      width={760}
      style={{ top: 24 }}
      styles={{
        body: {
          maxHeight: 'calc(100dvh - 180px)',
          overflowY: 'auto',
          paddingRight: 8,
        },
      }}
      onCancel={onClose}
      maskClosable={false}
      footer={
        <Space>
          <Button onClick={onClose}>
            {state.busy ? t('transferCancel') : t('transferClose')}
          </Button>
          <Button
            type="primary"
            loading={state.busy}
            disabled={
              !state.source ||
              !state.target ||
              state.loading ||
              !state.confirmed
            }
            onClick={() => void state.verify()}
          >
            {t('transferVerify')}
          </Button>
        </Space>
      }
    >
      <div className="transfer-editor">
        <Typography.Paragraph type="secondary">
          {t('transferIntro')}
        </Typography.Paragraph>
        <label htmlFor="transfer-target">{t('transferTarget')}</label>
        <Select
          id="transfer-target"
          value={state.targetId}
          placeholder={t('transferSelect')}
          disabled={!state.source || state.busy}
          loading={state.loading}
          options={cameras
            .filter((camera) => camera.id !== id)
            .map((camera) => ({ value: camera.id, label: camera.name }))}
          onChange={(value) => void state.select(value)}
        />
        {state.error && (
          <Alert
            type="error"
            showIcon
            message={
              state.error.code && knownErrors[state.error.code]
                ? t(knownErrors[state.error.code])
                : state.error.message
            }
          />
        )}
        {state.source &&
          endpoint(
            `${cameras.find((camera) => camera.id === id)?.name ?? id} · ${t('transferStart')}`,
            state.source.calibration.observationPose,
          )}
        <ArrowDown size={18} className="transfer-arrow" />
        {state.rows.map((row, index) => (
          <div className="transfer-waypoint" key={index}>
            <Typography.Text>
              {t('transferWaypoint')} {index + 1}
            </Typography.Text>
            {(['x', 'y', 'z'] as const).map((axis) => (
              <label key={axis} htmlFor={`waypoint-${index}-${axis}`}>
                {axis.toUpperCase()} (mm)
                <InputNumber
                  id={`waypoint-${index}-${axis}`}
                  aria-label={`${t('transferWaypoint')} ${index + 1} ${axis.toUpperCase()}`}
                  value={row[axis]}
                  disabled={state.busy}
                  onChange={(value) => state.edit(index, axis, value)}
                />
              </label>
            ))}
            <Button
              type="text"
              danger
              aria-label={`${t('transferRemove')} ${index + 1}`}
              icon={<Trash2 size={16} />}
              disabled={state.busy}
              onClick={() => state.remove(index)}
            />
          </div>
        ))}
        {!state.rows.length && (
          <Typography.Text type="secondary">
            {t('transferDirect')}
          </Typography.Text>
        )}
        <Button
          icon={<Plus size={16} />}
          disabled={
            !state.source ||
            !state.target ||
            state.busy ||
            state.rows.length >= 64
          }
          onClick={state.add}
        >
          {t('transferAdd')}
        </Button>
        <Typography.Text type="secondary">
          {t('transferMeasured')}
        </Typography.Text>
        <ArrowDown size={18} className="transfer-arrow" />
        {state.target &&
          endpoint(
            `${cameras.find((camera) => camera.id === state.targetId)?.name ?? ''} · ${t('transferEnd')}`,
            state.target.calibration.observationPose,
          )}
        <Checkbox
          checked={state.confirmed}
          disabled={state.busy || !state.target}
          onChange={(event) => state.confirm(event.target.checked)}
        >
          {t('transferConfirm')}
        </Checkbox>
        {route && (
          <Tag
            color={
              !state.dirty && route.status === 'verified' ? 'green' : 'orange'
            }
          >
            {t(
              state.dirty
                ? 'transferDraft'
                : route.status === 'verified'
                  ? 'transferVerified'
                  : 'transferStale',
            )}
          </Tag>
        )}
        <Typography.Text type="secondary">
          {t('transferLifetime')}
        </Typography.Text>
      </div>
    </Modal>
  );
}
