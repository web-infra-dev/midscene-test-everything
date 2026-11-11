import {
  Alert,
  Button,
  Input,
  Modal,
  Popconfirm,
  QRCode,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { House } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  CameraPhoneReadiness,
  InstallationConnection,
} from '../../hooks/useCameraPhoneReadiness';
import { t, useLanguage } from '../../i18n';
import { isRequiredPhonePage } from '../../utils/phone-readiness';

/** Longest name a screen may carry; the stage tag has to stay readable. */
const SCREEN_NAME_LIMIT = 40;

type PageState = 'connected' | 'markers' | 'waiting' | 'offline';

function pageState(
  device: Pick<InstallationConnection['devices'][number], 'mode' | 'visible'>,
): PageState {
  if (!device.visible) return 'offline';
  if (device.mode === 'mapping') return 'connected';
  if (device.mode === 'markers') return 'markers';
  return 'waiting';
}

/** One camera the page can be bound to. */
export interface PhoneConnectCamera {
  id: string;
  name: string;
  screenCount: number;
  /** Saved screens of this camera, so they can be named while connecting. */
  screens?: readonly { id: string; name: string; pageKey?: string }[];
}

/**
 * The screen page is a device, not a wizard step. This dialog is reachable from
 * the stage tag and from the camera step's checklist, and lists every open page
 * so a multi-screen workstation can connect one page per screen without typing
 * a pairing code on any phone. Pages are bound to the camera that observes
 * them: the current camera is selected by default, so a second camera can take
 * its own pages without mixing the two device sets. The QR/pairing fallback
 * stays available for a first connection or a phone that cannot open the link.
 */
export function PhoneConnectDialog({
  open,
  onClose,
  onContinue,
  readiness,
  cameras = [],
  onConnect,
  onAssignCamera,
  onRenamePage,
  onRenameScreens,
  onRestoreHome,
  onWake,
  onForget,
  connectingDeviceId,
  connectError,
}: {
  open: boolean;
  onClose: () => void;
  /** Continues from a first-screen Add Screen into the marker pass. */
  onContinue?: () => void;
  readiness?: CameraPhoneReadiness;
  /** Cameras a page can be bound to; the current camera is the default. */
  cameras?: readonly PhoneConnectCamera[];
  onConnect(deviceId: string, cameraId: string): void;
  /** Binds a page that is already connected to the selected camera. */
  onAssignCamera(deviceId: string, cameraId: string): void;
  /** Names the page itself; the name is stored on the page and survives reloads. */
  onRenamePage?: (
    deviceId: string,
    name: string,
    cameraId: string,
    screenId?: string,
    pageKey?: string,
  ) => Promise<void> | void;
  /** Names the selected camera's screens, for screens without a page. */
  onRenameScreens?: (
    cameraId: string,
    names: Record<string, string>,
  ) => Promise<void> | void;
  /** Releases the page to its waiting home view, keeping its camera binding. */
  onRestoreHome?: (deviceId: string) => Promise<void> | void;
  /** Re-opens the transport of a page that stopped reporting. */
  onWake?: (deviceId: string) => Promise<void> | void;
  /** Forgets an offline page record whose browser identity is gone. */
  onForget?: (deviceId: string) => Promise<void> | void;
  connectingDeviceId?: string;
  connectError?: string;
}) {
  useLanguage();
  const [selectedCameraId, setSelectedCameraId] = useState<string>();
  const currentCameraId = readiness?.cameraId;
  const cameraOptions = cameras.length
    ? cameras
    : currentCameraId
      ? [
          {
            id: currentCameraId,
            name: currentCameraId,
            screenCount: readiness?.requiredPhones ?? 1,
          },
        ]
      : [];
  const selectedCamera =
    cameraOptions.find((camera) => camera.id === selectedCameraId) ??
    cameraOptions.find((camera) => camera.id === currentCameraId) ??
    cameraOptions[0];
  const cameraId = selectedCamera?.id;
  /*
   * The page owns its name: the operator names the phone they can see (label
   * 132ABA), not an abstract screen index. The name is stored on the page and
   * survives a reload; when the page still reports the screen it calibrated,
   * the stage label is updated with the same name.
   */
  const savedScreens = selectedCamera?.screens ?? [];
  const [pageNames, setPageNames] = useState<Record<string, string>>({});
  const [savingPageId, setSavingPageId] = useState<string>();
  const [pageRenameError, setPageRenameError] = useState<string>();
  const [screenNames, setScreenNames] = useState<Record<string, string>>({});
  const [savingScreenId, setSavingScreenId] = useState<string>();
  const [screenRenameError, setScreenRenameError] = useState<string>();
  const [restoringPageId, setRestoringPageId] = useState<string>();
  const [restoreError, setRestoreError] = useState<string>();
  const openedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      openedRef.current = false;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    // Inputs fall back to the saved names; a new opening starts from the
    // camera, not from a draft left behind by the previous session.
    setPageNames({});
    setPageRenameError(undefined);
    setScreenNames({});
    setScreenRenameError(undefined);
    setRestoreError(undefined);
  }, [open]);
  /** The bound screen's current name; the stage and mapping use this name. */
  const boundScreenName = (device: InstallationConnection['devices'][number]) =>
    savedScreens.find((screen) => screen.id === device.screenId)?.name;
  const pageNameValue = (device: InstallationConnection['devices'][number]) =>
    pageNames[device.id] ?? boundScreenName(device) ?? device.name ?? '';
  const pageNameProblem = (
    device: InstallationConnection['devices'][number],
  ) => {
    const name = pageNameValue(device).trim();
    if (!name) return undefined;
    const duplicate = (readiness?.connection?.devices ?? []).some(
      (other) =>
        other.id !== device.id &&
        pageNameValue(other).trim().toLowerCase() === name.toLowerCase(),
    );
    return duplicate ? t('Screen names must be unique.') : undefined;
  };
  const savePageName = async (
    device: InstallationConnection['devices'][number],
  ) => {
    if (!cameraId || !onRenamePage) return;
    const name = pageNameValue(device).trim();
    if (!name) return;
    if (pageNameProblem(device)) return;
    setSavingPageId(device.id);
    setPageRenameError(undefined);
    try {
      await onRenamePage(
        device.id,
        name,
        cameraId,
        device.screenId,
        device.pageKey,
      );
      setPageNames((current) => ({ ...current, [device.id]: name }));
      message.success(t('Renamed the screens.'));
    } catch (error) {
      setPageRenameError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSavingPageId(undefined);
    }
  };
  const screenNameValue = (screen: { id: string; name: string }) =>
    screenNames[screen.id] ?? screen.name;
  const screenNameProblem = (screen: { id: string; name: string }) => {
    const name = screenNameValue(screen).trim();
    if (!name) return t('A screen name cannot be empty.');
    const duplicate = savedScreens.some(
      (other) =>
        other.id !== screen.id &&
        screenNameValue(other).trim().toLowerCase() === name.toLowerCase(),
    );
    return duplicate ? t('Screen names must be unique.') : undefined;
  };
  const saveScreenName = async (screen: { id: string; name: string }) => {
    if (!cameraId || !onRenameScreens) return;
    const name = screenNameValue(screen).trim();
    if (screenNameProblem(screen)) return;
    setSavingScreenId(screen.id);
    setScreenRenameError(undefined);
    try {
      await onRenameScreens(cameraId, { [screen.id]: name });
      setScreenNames((current) => ({ ...current, [screen.id]: name }));
      message.success(t('Renamed the screens.'));
    } catch (error) {
      setScreenRenameError(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setSavingScreenId(undefined);
    }
  };
  const restoreHome = async (deviceId: string) => {
    if (!onRestoreHome) return;
    setRestoringPageId(deviceId);
    setRestoreError(undefined);
    try {
      await onRestoreHome(deviceId);
      message.success(t('Restored the page to its home view.'));
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : String(error));
    } finally {
      setRestoringPageId(undefined);
    }
  };
  /*
   * A page belongs to the selected camera when it is bound to it. A page that is
   * not bound yet is listed for every camera so it can be claimed, but it stays
   * visibly unbound and does not count until the operator binds it: otherwise
   * the same two pages would make every camera look complete.
   */
  const pages = (readiness?.connection?.devices ?? []).filter(
    (device) => !device.cameraId || !cameraId || device.cameraId === cameraId,
  );
  const otherCameraPages = (readiness?.connection?.devices ?? []).filter(
    (device) => device.cameraId && cameraId && device.cameraId !== cameraId,
  );
  /*
   * Two different facts, and the dialog must not conflate them. A page is
   * "ready" for this camera once it is open, fullscreen and bound to the
   * camera; that is what lets the setup continue, and page mapping is prepared
   * later from such a page. A page is "connected" only while it actually serves
   * a role (page mapping or marker calibration); a page waiting at its home
   * view is listed as Not connected on its own row and must not be counted as
   * connected in the summary.
   */
  const readyPhones = pages.filter(
    (device) =>
      isRequiredPhonePage(device, cameraId, selectedCamera?.screens) &&
      device.visible &&
      device.fullscreen,
  ).length;
  const connectedPhones = pages.filter(
    (device) =>
      isRequiredPhonePage(device, cameraId, selectedCamera?.screens) &&
      device.visible &&
      device.fullscreen &&
      pageState(device) !== 'waiting',
  ).length;
  const unboundReadyPages = pages.filter(
    (device) => !device.cameraId && device.visible && device.fullscreen,
  ).length;
  /*
   * A screen is matched to a page either by the screen it reports (while the
   * page's marker session is alive) or by the stable page identity stored on
   * the binding, which survives page reloads and service restarts.
   */
  const matchedScreenIds = new Set<string>();
  for (const device of pages) {
    if (device.cameraId !== cameraId) continue;
    if (device.screenId) matchedScreenIds.add(device.screenId);
    if (device.pageKey) {
      const binding = savedScreens.find(
        (screen) => screen.pageKey && screen.pageKey === device.pageKey,
      );
      if (binding) matchedScreenIds.add(binding.id);
    }
  }
  const unmatchedScreens = savedScreens.filter(
    (screen) => !matchedScreenIds.has(screen.id),
  );
  const requiredPhones = Math.max(1, selectedCamera?.screenCount ?? 1);
  /*
   * The configured screens decide the count; another page being open is not a
   * fault, because a multi-screen bench keeps one page per screen.
   */
  const phonesReady = readyPhones >= requiredPhones;
  const phonesConnected = connectedPhones >= requiredPhones;
  const readyCount = Math.max(readyPhones, requiredPhones);
  const connectedCount = Math.max(connectedPhones, requiredPhones);
  const markerPages = pages.filter((device) => pageState(device) === 'markers');
  const backgrounded = pages.some(
    (device) => device.visible && !device.fullscreen,
  );
  const publicUrl = readiness?.connection?.publicUrl;
  /*
   * The green success belongs to pages that are actually connected. Pages that
   * are open and bound but still at their home view get an informational
   * summary: the setup may continue (page mapping is prepared in Screen
   * Calibration), but the dialog must not claim a connection that is not there.
   */
  const connectionNotice = phonesConnected
    ? {
        tone: 'success' as const,
        message:
          connectedCount > requiredPhones
            ? t('{0} screen pages are connected. You can continue.', [
                String(connectedCount),
              ])
            : requiredPhones > 1
              ? t('All {0} screen pages are connected. You can continue.', [
                  String(connectedCount),
                ])
              : t('Phone connected. You can continue.'),
      }
    : phonesReady
      ? {
          tone: 'info' as const,
          message:
            readyCount > 1
              ? t(
                  'All {0} screen pages are open and assigned to this camera. You can continue.',
                  [String(readyCount)],
                )
              : t(
                  'The screen page is open and assigned to this camera. You can continue.',
                ),
        }
      : unboundReadyPages
        ? {
            tone: 'info' as const,
            message: t(
              'Bind each fullscreen page to this camera; an unbound page does not count.',
            ),
          }
        : {
            tone: 'info' as const,
            message:
              requiredPhones > 1
                ? t('Waiting for {0} fullscreen screen pages.', [
                    String(requiredPhones),
                  ])
                : t('Waiting for a fullscreen phone page.'),
          };
  return (
    <Modal
      centered
      className="robot-dialog phone-connect-dialog"
      footer={null}
      onCancel={onClose}
      open={open}
      title={t('Connect Phone')}
      width="min(560px, 94vw)"
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {cameraOptions.length > 1 ? (
          <div className="phone-connect-camera">
            <Typography.Text strong>{t('Observing camera')}</Typography.Text>
            <Select
              aria-label={t('Observing camera')}
              onChange={(value) => setSelectedCameraId(value)}
              options={cameraOptions.map((camera) => ({
                value: camera.id,
                label: camera.name,
              }))}
              style={{ width: '100%' }}
              value={cameraId}
            />
            <Typography.Text type="secondary">
              {t(
                'A page is bound to this camera when it connects; bind an already connected page on its row. The current camera is selected by default.',
              )}
            </Typography.Text>
          </div>
        ) : null}
        <Typography.Paragraph type="secondary">
          {t(
            pages.length > 1
              ? 'Saved and connected screen pages are listed below. Keep one active page per screen.'
              : pages.length
                ? 'Open the page on the phone, then select the device below.'
                : 'Open the screen page on the phone. It appears here automatically.',
          )}
        </Typography.Paragraph>
        {pages.length ? (
          <>
            <ul className="phone-connect-pages">
              {pages.map((device) => {
                const state = pageState(device);
                const nameProblem =
                  device.cameraId === cameraId && onRenamePage
                    ? pageNameProblem(device)
                    : undefined;
                return (
                  <li className="phone-connect-page" key={device.id}>
                    <div className="phone-connect-page-id">
                      <Typography.Text strong>{device.label}</Typography.Text>
                      <Typography.Text type="secondary">
                        {device.width > 0 && device.height > 0
                          ? `${device.width} × ${device.height}`
                          : null}
                      </Typography.Text>
                      <Tag
                        color={
                          state === 'connected'
                            ? 'green'
                            : state === 'markers'
                              ? 'blue'
                              : state === 'offline'
                                ? 'red'
                                : undefined
                        }
                      >
                        {state === 'connected'
                          ? t('Connected')
                          : state === 'markers'
                            ? t('Marker Calibration')
                            : state === 'offline'
                              ? t('Page offline')
                              : t('Not connected')}
                      </Tag>
                      {device.fullscreen || state === 'offline' ? null : (
                        <Tag color="orange">{t('Not fullscreen')}</Tag>
                      )}
                      {device.cameraId ? null : (
                        <Tag color="gold">{t('Unbound')}</Tag>
                      )}
                    </div>
                    <div className="phone-connect-page-actions">
                      {state === 'offline' && onWake ? (
                        <Space size={4}>
                          <Tooltip
                            title={t(
                              'Unlock the phone and bring this page back to the foreground, then reconnect it.',
                            )}
                          >
                            <Button
                              aria-label={t('Reconnect {0}', [device.label])}
                              loading={device.id === connectingDeviceId}
                              onClick={() => onWake(device.id)}
                              size="small"
                            >
                              {t('Reconnect page')}
                            </Button>
                          </Tooltip>
                          {onForget ? (
                            <Popconfirm
                              title={t(
                                'Remove this offline page with its screen and perspective? This cannot be undone.',
                              )}
                              okText={t('Remove page')}
                              onConfirm={() => onForget(device.id)}
                            >
                              <Button
                                aria-label={t('Remove page {0}', [
                                  device.label,
                                ])}
                                size="small"
                                type="text"
                              >
                                {t('Remove page')}
                              </Button>
                            </Popconfirm>
                          ) : null}
                        </Space>
                      ) : null}
                      {state !== 'waiting' &&
                      state !== 'offline' &&
                      onRestoreHome ? (
                        <Tooltip
                          title={t(
                            'Return this page to its home view and release its page-mapping session.',
                          )}
                        >
                          <Button
                            aria-label={t('Restore {0} to its home page', [
                              device.label,
                            ])}
                            icon={<House size={14} />}
                            loading={restoringPageId === device.id}
                            onClick={() => void restoreHome(device.id)}
                            size="small"
                            type="text"
                          >
                            {t('Restore Home')}
                          </Button>
                        </Tooltip>
                      ) : null}
                      {state === 'waiting' && cameraId ? (
                        <Button
                          aria-label={t('Connect {0} to {1}', [
                            device.label,
                            selectedCamera?.name ?? '',
                          ])}
                          disabled={!device.visible}
                          size="small"
                          type="primary"
                          loading={device.id === connectingDeviceId}
                          onClick={() => onConnect(device.id, cameraId)}
                        >
                          {t('Connect This Device')}
                        </Button>
                      ) : null}
                      {state !== 'waiting' &&
                      state !== 'offline' &&
                      !device.cameraId &&
                      cameraId ? (
                        <Button
                          aria-label={t('Bind {0} to {1}', [
                            device.label,
                            selectedCamera?.name ?? '',
                          ])}
                          size="small"
                          loading={device.id === connectingDeviceId}
                          onClick={() => onAssignCamera(device.id, cameraId)}
                        >
                          {t('Bind to this camera')}
                        </Button>
                      ) : null}
                    </div>
                    {device.cameraId === cameraId && onRenamePage ? (
                      <div className="phone-connect-page-screen">
                        <Typography.Text type="secondary">
                          {t('Screen name (optional)')}
                        </Typography.Text>
                        <Input
                          aria-label={t('Screen name for {0}', [device.label])}
                          maxLength={SCREEN_NAME_LIMIT}
                          placeholder={
                            boundScreenName(device) ??
                            device.name ??
                            device.label
                          }
                          onChange={(event) =>
                            setPageNames((current) => ({
                              ...current,
                              [device.id]: event.target.value,
                            }))
                          }
                          size="small"
                          status={nameProblem ? 'warning' : undefined}
                          value={pageNameValue(device)}
                        />
                        <Button
                          disabled={
                            Boolean(nameProblem) ||
                            !pageNameValue(device).trim() ||
                            pageNameValue(device).trim() === (device.name ?? '')
                          }
                          loading={savingPageId === device.id}
                          onClick={() => void savePageName(device)}
                          size="small"
                          type="link"
                        >
                          {t('Save')}
                        </Button>
                        {nameProblem ? (
                          <Typography.Text
                            className="phone-connect-page-screen-problem"
                            type="warning"
                          >
                            {nameProblem}
                          </Typography.Text>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <Typography.Paragraph type="secondary">
              {markerPages.length
                ? t(
                    'Use Restore Home on a page in marker calibration before connecting it here.',
                  )
                : t('Keep each screen page visible and in fullscreen.')}
            </Typography.Paragraph>
          </>
        ) : (
          <Typography.Paragraph type="secondary">
            {t('Waiting for a screen page to open...')}
          </Typography.Paragraph>
        )}
        {pageRenameError ? (
          <Typography.Text type="danger">{pageRenameError}</Typography.Text>
        ) : null}
        {restoreError ? (
          <Typography.Text type="danger">{restoreError}</Typography.Text>
        ) : null}
        {screenRenameError ? (
          <Typography.Text type="danger">{screenRenameError}</Typography.Text>
        ) : null}
        {unmatchedScreens.length && onRenameScreens ? (
          <div className="phone-connect-screens">
            <Typography.Text strong>{t('Other screens')}</Typography.Text>
            <Typography.Text type="secondary">
              {t(
                'These screens are not linked to a page right now. Naming them here keeps the stage labels correct.',
              )}
            </Typography.Text>
            {unmatchedScreens.map((screen) => {
              const position = savedScreens.indexOf(screen) + 1;
              const problem = screenNameProblem(screen);
              return (
                <div className="phone-connect-screen-row" key={screen.id}>
                  <Typography.Text type="secondary">
                    {t('Screen {0}', [String(position)])}
                  </Typography.Text>
                  <Input
                    aria-label={t('Screen {0} name', [String(position)])}
                    maxLength={SCREEN_NAME_LIMIT}
                    onChange={(event) =>
                      setScreenNames((current) => ({
                        ...current,
                        [screen.id]: event.target.value,
                      }))
                    }
                    size="small"
                    status={problem ? 'warning' : undefined}
                    value={screenNameValue(screen)}
                  />
                  <Button
                    disabled={
                      Boolean(problem) ||
                      screenNameValue(screen) === screen.name
                    }
                    loading={savingScreenId === screen.id}
                    onClick={() => void saveScreenName(screen)}
                    size="small"
                    type="link"
                  >
                    {t('Save')}
                  </Button>
                  {problem ? (
                    <Typography.Text
                      className="phone-connect-page-screen-problem"
                      type="warning"
                    >
                      {problem}
                    </Typography.Text>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
        {cameraId && otherCameraPages.length > 0 && (
          <details className="robot-device-pairing">
            <summary>{t('Pages on other cameras')}</summary>
            {otherCameraPages.map((device) => (
              <div key={device.id} className="phone-connect-screen-row">
                <Typography.Text>{device.name ?? device.label}</Typography.Text>
                <Button
                  size="small"
                  loading={device.id === connectingDeviceId}
                  onClick={() => onAssignCamera(device.id, cameraId)}
                >
                  {t('Bind to this camera')}
                </Button>
              </div>
            ))}
          </details>
        )}
        {connectError && <Alert type="error" message={connectError} />}
        {readiness?.error && <Alert type="error" message={readiness.error} />}
        {backgrounded && (
          <Alert
            type="info"
            message={t(
              'The page must be in fullscreen before calibration starts: tap Enter full screen on the phone. If the system keeps a status bar or refuses fullscreen, use the phone browser menu, then tap Full screen ready on the phone. System bars may remain; calibration uses the visible page area. Confirm again after resizing or rotating.',
            )}
          />
        )}
        <Alert
          type={connectionNotice.tone}
          message={connectionNotice.message}
        />
        {onContinue && (
          <Button
            block
            disabled={!phonesConnected}
            onClick={onContinue}
            type="primary"
          >
            {t('Continue to Calibration')}
          </Button>
        )}
        {publicUrl && (
          <details className="robot-device-pairing">
            <summary>{t('Phone page address')}</summary>
            {publicUrl && (
              <div className="robot-device-phone-link">
                <QRCode value={publicUrl} size={120} type="svg" />
                <div className="robot-device-phone-address">
                  <Typography.Text type="secondary">
                    {t('Phone page address')}
                  </Typography.Text>
                  <Typography.Paragraph copyable={{ text: publicUrl }}>
                    <Typography.Link
                      href={publicUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {publicUrl}
                    </Typography.Link>
                  </Typography.Paragraph>
                </div>
              </div>
            )}
          </details>
        )}
      </Space>
    </Modal>
  );
}
