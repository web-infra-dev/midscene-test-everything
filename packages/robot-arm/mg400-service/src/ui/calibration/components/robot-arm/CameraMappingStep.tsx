import {
  type WebCalibrationMapping,
  mappingQualityWarnings,
} from '@midscene/robotics-shared/assisted-contracts';
import { measuredPerspectiveTarget } from '@midscene/robotics-shared/camera/vision-geometry';
import type { CameraCorrection } from '@midscene/robotics-shared/contracts';
import { Alert, Button, Modal, Select, Space, Tag, Typography } from 'antd';
import { Check, CircleSlash, ScanLine } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CameraCornerEditor } from '../../CameraCornerEditor';
import { CorrectedPreview } from '../../CorrectedPreview';
import { calibrationErrorText, t, useCalibrationLanguage } from '../../i18n';
import { cameraPreviewUrl } from '../../preview-url';
import { speakCalibration } from '../../voice/calibration';
import { CalibrationQualityWarnings } from './CalibrationQualityWarnings';

/** One screen the camera observes; the sheet of glass a mapping belongs to. */
export interface CameraMappingScreen {
  id: string;
  name: string;
  hasCorrection?: boolean;
  /** The saved quad, so the stage can draw every screen at once. */
  correction?: CameraCorrection;
}

type ChecklistEntry = {
  title: string;
  detail?: string;
  done: boolean;
  action?: ReactNode;
};

/**
 * The camera step of the workstation setup, migrated from the robot-vision
 * checklist: a camera, the screen it observes, the page on that screen, the
 * perspective preset and the mapping that ties them together. It is a checklist
 * rather than a wizard because every entry is a device action the operator can
 * repeat in any order, and because a camera that watches several screens needs
 * the same five checks per screen.
 */
export function CameraMappingStep({
  camera,
  screens,
  screenId,
  base,
  correction,
  output,
  validity,
  phoneConnected,
  phoneFullscreen = phoneConnected,
  mappingReady = true,
  mapping,
  mappingError,
  footer,
  busy,
  perspectiveOpen,
  onPerspectiveOpenChange,
  onSelectScreen,
  onAddScreen,
  onPair,
  onDetect,
  onApply,
  onConfirm,
  onClear,
  onContinue,
  refresh,
}: {
  camera: { name: string; online: boolean };
  screens: readonly CameraMappingScreen[];
  screenId?: string;
  /** Host base path of the selected screen, used for its live preview. */
  base: string;
  correction?: CameraCorrection;
  output?: { width: number; height: number };
  /** Outline verdict of the selected screen, shown next to its applied tag. */
  validity?: 'valid' | 'invalid' | 'suspected' | 'unverified';
  phoneConnected: boolean;
  /**
   * The page reports its viewport only in fullscreen; without it the marker
   * display never becomes ready, so the mapping cannot be confirmed.
   */
  phoneFullscreen?: boolean;
  mappingReady?: boolean;
  mapping?: WebCalibrationMapping;
  mappingError?: string;
  footer: HTMLElement | null;
  busy?: boolean;
  /**
   * Controlled by the host: marker detection hands a failed pass over to this
   * editor, so the host owns whether the editor is open.
   */
  perspectiveOpen?: boolean;
  onPerspectiveOpenChange?(open: boolean): void;
  onSelectScreen?(id: string): void;
  onAddScreen?(): void;
  onPair(): void;
  onDetect(): void;
  onApply(
    updates: ReadonlyArray<{ screenId: string; correction: CameraCorrection }>,
  ): Promise<void>;
  onConfirm?(correction: CameraCorrection): Promise<void>;
  /** Releases the applied perspective but keeps the screen and its page. */
  onClear?(): Promise<void>;
  onContinue(): void;
  refresh(): Promise<void>;
}) {
  useCalibrationLanguage((state) => state.language);
  const [editorOpenState, setEditorOpenState] = useState(false);
  const editorOpen = perspectiveOpen ?? editorOpenState;
  const setEditorOpen = (open: boolean) => {
    setEditorOpenState(open);
    onPerspectiveOpenChange?.(open);
  };
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string>();
  const [error, setError] = useState<string>();
  const screen = screens.find((entry) => entry.id === screenId);
  const mapped = Boolean(correction);
  const canConfirm =
    mapped && phoneConnected && phoneFullscreen && validity !== 'invalid';
  const verified = canConfirm && mappingReady && !mappingError;
  const notice = error ?? mappingError;
  useEffect(() => speakCalibration('cameraSetup'), [screenId]);
  const apply = async (
    updates: ReadonlyArray<{
      screenId: string;
      correction: CameraCorrection;
    }>,
  ) => {
    setError(undefined);
    await onApply(updates);
    await refresh();
  };
  const confirm = async () => {
    if (!correction || !onConfirm) return;
    setError(undefined);
    try {
      await onConfirm(correction);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const entries: ChecklistEntry[] = [
    {
      title: t('Camera online'),
      detail: camera.online
        ? camera.name
        : t('Select an online camera to see its preview.'),
      done: camera.online,
    },
    {
      title: t('Calibration Screen'),
      done: Boolean(screen),
      action: (
        <Space size={4} wrap>
          {onSelectScreen && screens.length > 1 && (
            <Select
              aria-label={t('Calibration Screen')}
              // A camera id that has no screen target yet is not a choice; show
              // the prompt instead of rendering the raw device id.
              value={
                screens.some((entry) => entry.id === screenId)
                  ? screenId
                  : undefined
              }
              placeholder={t('Select a screen for calibration')}
              style={{ width: 170 }}
              options={screens.map((entry) => ({
                value: entry.id,
                label: entry.name,
              }))}
              onChange={onSelectScreen}
            />
          )}
          {onAddScreen && (
            <Button size="small" onClick={onAddScreen}>
              {t('Add Screen')}
            </Button>
          )}
        </Space>
      ),
    },
    {
      title: t('Screen page'),
      detail: !phoneConnected
        ? t(
            'Open the calibration page on your phone and keep it in the foreground.',
          )
        : phoneFullscreen
          ? t('Phone connected. You can continue.')
          : t('Keep each screen page visible and in fullscreen.'),
      done: phoneConnected && phoneFullscreen,
      action: (
        <Button size="small" onClick={onPair}>
          {t(phoneConnected ? 'View Phone Page' : 'Connect Phone')}
        </Button>
      ),
    },
    {
      title: t('Perspective Correction'),
      detail: mapped
        ? t('Perspective preset ready')
        : t('No perspective preset'),
      done: mapped,
      action: (
        <Space size={4} wrap>
          {/*
            The phone page carries the marker layout, so detection is the
            primary path: it fits the page rectangle from the markers instead of
            asking the operator to guess the glass edges. Placing the corners by
            hand stays available as a link for a view the markers cannot explain.
          */}
          <Button
            size="small"
            type="primary"
            icon={<ScanLine size={14} />}
            disabled={!camera.online || busy}
            onClick={onDetect}
          >
            {t('Detect screen markers')}
          </Button>
          <Button
            size="small"
            type="link"
            disabled={!camera.online || busy}
            onClick={() => setEditorOpen(true)}
          >
            {t(mapped ? 'Correct Perspective' : 'Set Up Perspective')}
          </Button>
        </Space>
      ),
    },
    {
      title: t('Camera Mapping'),
      detail: verified
        ? t('Camera mapping confirmed')
        : t('Confirm that the corrected image matches the screen.'),
      done: verified,
      action:
        onConfirm && !verified ? (
          <Button
            size="small"
            type="primary"
            disabled={!canConfirm || busy}
            onClick={() => void confirm()}
          >
            {t('Confirm Camera Mapping')}
          </Button>
        ) : undefined,
    },
  ];
  return (
    <div className="camera-checklist">
      <ol className="camera-checklist-list">
        {entries.map((entry, index) => (
          <li data-done={entry.done} key={entry.title}>
            <span aria-hidden className="camera-checklist-index">
              {entry.done ? <Check size={14} /> : index + 1}
            </span>
            <div className="camera-checklist-text">
              <Typography.Text strong>{entry.title}</Typography.Text>
              {entry.detail && (
                <Typography.Text type="secondary">
                  {entry.detail}
                </Typography.Text>
              )}
            </div>
            <div className="camera-checklist-action">{entry.action}</div>
          </li>
        ))}
      </ol>
      {phoneConnected && !phoneFullscreen && (
        <Alert
          type="warning"
          showIcon
          message={t('Enter full screen on the page first.')}
        />
      )}
      <div className="camera-mapping-applied">
        {screens.length ? (
          screens.map((entry) => (
            <Tag
              key={entry.id}
              bordered={false}
              color={entry.correction ? 'success' : 'warning'}
              icon={
                entry.correction ? (
                  <Check size={12} />
                ) : (
                  <CircleSlash size={12} />
                )
              }
            >
              {entry.correction ? (
                <>
                  {t('Perspective applied')} · {entry.name}
                </>
              ) : (
                <>
                  {t('Perspective not applied')} · {entry.name}
                </>
              )}
            </Tag>
          ))
        ) : (
          <Tag bordered={false} icon={<CircleSlash size={12} />}>
            {t('Perspective not applied')}
          </Tag>
        )}
        {validity === 'invalid' && (
          <Tag bordered={false} color="error">
            {t('Perspective stale')}
          </Tag>
        )}
        {validity === 'suspected' && (
          <Tag bordered={false} color="warning">
            {t('Perspective needs review')}
          </Tag>
        )}
        {screens.some((entry) => entry.correction) && onClear && (
          <Button
            danger
            size="small"
            type="link"
            onClick={() => {
              setClearError(undefined);
              setClearOpen(true);
            }}
          >
            {t('Clear Applied Perspective')}
          </Button>
        )}
      </div>
      {notice && (
        <Alert type="error" showIcon message={calibrationErrorText(notice)} />
      )}
      {mapped && mapping && (
        <CalibrationQualityWarnings
          warnings={mappingQualityWarnings(mapping.accuracy, mapping.layout)}
        />
      )}
      {footer
        ? createPortal(
            <Button
              type="primary"
              disabled={!verified || busy}
              onClick={onContinue}
            >
              {t('Next Step')}
            </Button>,
            footer,
          )
        : null}
      <Modal
        open={clearOpen}
        centered
        title={t('Clear Perspective Correction')}
        okText={t('Clear Applied Perspective')}
        cancelText={t('Cancel')}
        okButtonProps={{ danger: true, loading: clearing }}
        cancelButtonProps={{ disabled: clearing }}
        onCancel={() => {
          if (!clearing) setClearOpen(false);
        }}
        onOk={async () => {
          if (!onClear) return;
          setClearing(true);
          setClearError(undefined);
          try {
            await onClear();
            setClearOpen(false);
          } catch (cause) {
            setClearError(
              cause instanceof Error ? cause.message : String(cause),
            );
          } finally {
            setClearing(false);
          }
        }}
      >
        <Typography.Paragraph>
          {t('Clear every applied perspective correction for this camera?')}
        </Typography.Paragraph>
        <Typography.Text type="secondary">
          {t('Saved screens are kept for recalibration.')}
        </Typography.Text>
        {clearError && <Alert type="error" showIcon message={clearError} />}
      </Modal>
      <PerspectiveEditor
        open={editorOpen}
        base={base}
        live={cameraPreviewUrl(base, 'mapping-live')}
        corrected={cameraPreviewUrl(base, 'mapping-editor-corrected')}
        screens={screens.filter(
          (
            entry,
          ): entry is CameraMappingScreen & { correction: CameraCorrection } =>
            Boolean(entry.correction),
        )}
        screenId={screenId}
        correction={correction}
        output={output}
        onClose={() => setEditorOpen(false)}
        onDetect={() => {
          setEditorOpen(false);
          onDetect();
        }}
        onApply={async (updates) => {
          try {
            await apply(updates);
            setEditorOpen(false);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        }}
        onError={(cause) =>
          setError(cause instanceof Error ? cause.message : String(cause))
        }
      />
    </div>
  );
}

/**
 * The perspective editor behind "Set Up Perspective": the same detected/manual
 * pair the workstation used. Detected mode delegates to the marker session,
 * which is the only path that knows the phone's marker layout; manual mode lets
 * the operator put the four corners on the glass when markers cannot be seen.
 */
function PerspectiveEditor({
  open,
  base,
  live,
  corrected,
  screens,
  screenId,
  correction,
  output,
  onClose,
  onDetect,
  onApply,
  onError,
}: {
  open: boolean;
  base: string;
  live: string;
  /** Separate MJPEG slot; sharing `live` would make the two retire each other. */
  corrected: string;
  screens: ReadonlyArray<
    CameraMappingScreen & { correction: CameraCorrection }
  >;
  screenId?: string;
  correction?: CameraCorrection;
  output?: { width: number; height: number };
  onClose(): void;
  onDetect(): void;
  onApply(
    updates: ReadonlyArray<{ screenId: string; correction: CameraCorrection }>,
  ): Promise<void>;
  onError(cause: unknown): void;
}) {
  useCalibrationLanguage((state) => state.language);
  const [activeScreenId, setActiveScreenId] = useState(screenId);
  const [drafts, setDrafts] = useState<
    Record<string, CameraCorrection | undefined>
  >({});
  const [saving, setSaving] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  /** A frame that never arrives would otherwise leave the editor empty forever. */
  const [frameError, setFrameError] = useState(false);
  const screensKey = screens
    .map((screen) => `${screen.id}:${JSON.stringify(screen.correction)}`)
    .join('|');
  useEffect(() => {
    if (!open) return;
    setActiveScreenId(screenId);
    setDrafts(
      Object.fromEntries(
        screens.map((screen) => [
          screen.id,
          structuredClone(screen.correction),
        ]),
      ),
    );
    setFrameError(false);
  }, [open, screenId, screensKey]);
  const activeScreen =
    screens.find((screen) => screen.id === activeScreenId) ?? screens[0];
  const draft =
    drafts[activeScreen?.id ?? screenId] ??
    (activeScreen?.id === screenId ? correction : activeScreen?.correction);
  const screenBase = (id: string) =>
    `/api/devices/${encodeURIComponent(id)}/calibration`;
  /* A camera without a saved preset still needs a rectangle to drag. */
  useEffect(() => {
    if (!open || draft) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active) return;
      const width = image.naturalWidth;
      const height = image.naturalHeight;
      if (!width || !height) return;
      const insetX = width * 0.1;
      const insetY = height * 0.1;
      const initial = {
        points: {
          topLeft: { x: insetX, y: insetY },
          topRight: { x: width - insetX, y: insetY },
          bottomRight: { x: width - insetX, y: height - insetY },
          bottomLeft: { x: insetX, y: height - insetY },
        },
        sourceWidth: width,
        sourceHeight: height,
        rotation: 0,
      } satisfies CameraCorrection;
      setDrafts((current) => ({
        ...current,
        [activeScreen?.id ?? screenId]: initial,
      }));
    };
    image.onerror = () => {
      if (active) setFrameError(true);
    };
    image.src = `${base}/camera/frame?t=${Date.now()}`;
    return () => {
      active = false;
    };
  }, [open, draft, activeScreen?.id, screenId, base, frameKey]);
  const size =
    (activeScreen?.id === screenId ? output : undefined) ??
    (draft && measuredPerspectiveTarget(draft.points, draft.rotation));
  const overlays = screens.map((screen) => ({
    id: screen.id,
    name: screen.name,
    value: drafts[screen.id] ?? screen.correction,
    active: screen.id === activeScreen?.id,
  }));
  const activeCorrected =
    activeScreen && activeScreen.id !== screenId
      ? cameraPreviewUrl(
          screenBase(activeScreen.id),
          `mapping-editor-corrected-${activeScreen.id}`,
        )
      : corrected;
  return (
    <Modal
      open={open}
      destroyOnClose
      width="min(1100px, 96vw)"
      footer={null}
      title={t('Perspective Correction')}
      onCancel={onClose}
    >
      <div className="guided-mapping-editor">
        {!draft ? (
          frameError ? (
            <Alert
              type="error"
              showIcon
              message={t('The camera frame could not be loaded')}
              description={t('Check that the camera is streaming, then retry.')}
              action={
                <Button
                  size="small"
                  onClick={() => {
                    setFrameError(false);
                    setFrameKey((value) => value + 1);
                  }}
                >
                  {t('Retry')}
                </Button>
              }
            />
          ) : (
            <Alert
              type="info"
              showIcon
              message={t('Adjust the four corners')}
              description={t('Select an online camera to see its preview.')}
            />
          )
        ) : (
          <div className="screen-range-card">
            <section>
              <header>
                <strong>{t('Live Preview')}</strong>
                <div className="range-actions">
                  {screens.length > 1 && (
                    <Select
                      size="small"
                      aria-label={t('Screen outline')}
                      value={activeScreen?.id ?? screenId}
                      options={screens.map((screen) => ({
                        value: screen.id,
                        label: screen.name,
                      }))}
                      onChange={setActiveScreenId}
                    />
                  )}
                  <Button
                    size="small"
                    disabled={saving}
                    onClick={() => {
                      setFrameError(false);
                      setFrameKey((value) => value + 1);
                    }}
                  >
                    {t('Refresh')}
                  </Button>
                  <Button size="small" disabled={saving} onClick={onDetect}>
                    {t('Detect screen markers')}
                  </Button>
                </div>
              </header>
              <div className="screen-range-stage">
                <CameraCornerEditor
                  key={`${activeScreen?.id ?? screenId}-${frameKey}`}
                  value={draft}
                  src={live}
                  disabled={saving}
                  overlays={overlays}
                  onChange={(value) => {
                    if (!activeScreen) return;
                    setDrafts((current) => ({
                      ...current,
                      [activeScreen.id]: value,
                    }));
                  }}
                />
              </div>
            </section>
            <section>
              <header>
                <strong>{t('Corrected View')}</strong>
                {size && (
                  <small>
                    {size.width} × {size.height} px
                  </small>
                )}
              </header>
              <div className="screen-range-stage corrected-preview-stage">
                {size && (
                  <CorrectedPreview
                    correction={draft}
                    size={size}
                    src={activeCorrected}
                  />
                )}
              </div>
            </section>
          </div>
        )}
        <Space>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            type="primary"
            loading={saving}
            disabled={!draft}
            onClick={async () => {
              if (!draft) return;
              setSaving(true);
              try {
                const updates = screens.flatMap((screen) => {
                  const value = drafts[screen.id];
                  return value &&
                    JSON.stringify(value) !== JSON.stringify(screen.correction)
                    ? [{ screenId: screen.id, correction: value }]
                    : [];
                });
                await onApply(updates);
              } catch (cause) {
                onError(cause);
              } finally {
                setSaving(false);
              }
            }}
          >
            {t('Apply')}
          </Button>
        </Space>
      </div>
    </Modal>
  );
}
