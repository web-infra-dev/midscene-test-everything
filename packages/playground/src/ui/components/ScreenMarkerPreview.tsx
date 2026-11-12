import type { PerspectiveRotation } from '@midscene/robotics-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/robotics-shared/contracts';
import {
  Alert,
  Button,
  Modal,
  QRCode,
  Select,
  Space,
  Spin,
  Typography,
} from 'antd';
import { ScanLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cameraPreviewUrl } from '../camera-preview';
import { useLanguage } from '../i18n';
import { LiveCameraImage } from './LiveCameraImage';

export interface CameraMarkerDetection {
  evidence: { token: string; pageKey: string };
  correction: CameraCorrection;
  jpeg: string;
  markerIds: number[];
  validFrames: number;
  frameCount: number;
  jitterPx: number;
  errorPx: number;
  screenWidthPx: number;
  screenHeightPx: number;
  rotation: PerspectiveRotation;
}
interface MarkerSession {
  token: string;
  links: { name: string; url: string }[];
}
interface PageStatus {
  state: string;
  pageKey?: string;
}

const endpoint = '/api/cameras/markers';
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const value = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(value.error), { code: value.code });
  return value;
}

export function ScreenMarkerPreview({
  id,
  name,
  onDetected,
  openRequest = 0,
  disabled = false,
  onOpenChange,
}: {
  id: string;
  name: string;
  onDetected(result: CameraMarkerDetection): void;
  openRequest?: number;
  disabled?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const changeOpen = (value: boolean) => {
    setOpen(value);
    onOpenChange?.(value);
  };
  useEffect(() => {
    if (openRequest > 0) {
      setOpen(true);
      onOpenChange?.(true);
    }
  }, [openRequest]);
  const title =
    useLanguage() === 'zh' ? '识别屏幕标记' : 'Detect screen markers';
  return (
    <>
      <Button
        disabled={disabled}
        icon={<ScanLine size={16} />}
        onClick={() => changeOpen(true)}
      >
        {title}
      </Button>
      {open && (
        <Modal
          open
          title={`${title} · ${name}`}
          onCancel={() => changeOpen(false)}
          footer={null}
          width={900}
        >
          <MarkerDialog
            key={id}
            id={id}
            name={name}
            onDetected={(result) => {
              onDetected(result);
              changeOpen(false);
            }}
          />
        </Modal>
      )}
    </>
  );
}

function MarkerDialog({
  id,
  name,
  onDetected,
}: {
  id: string;
  name: string;
  onDetected(result: CameraMarkerDetection): void;
}) {
  const zh = useLanguage() === 'zh';
  const [session, setSession] = useState<MarkerSession>();
  const [chosen, setChosen] = useState<string>();
  const [page, setPage] = useState<PageStatus>();
  const [connectionError, setConnectionError] = useState<string>();
  const [error, setError] = useState<string>();
  const finish = useRef(onDetected);
  finish.current = onDetected;
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let url: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await request<PageStatus>(url!, { signal: abort.signal });
        setPage(next);
        setConnectionError(undefined);
      } catch (e) {
        if (!abort.signal.aborted) {
          setPage(undefined);
          setConnectionError(String(e));
        }
      } finally {
        if (!abort.signal.aborted) timer = setTimeout(poll, 800);
      }
    }
    void request<MarkerSession>(`${endpoint}?id=${encodeURIComponent(id)}`, {
      method: 'POST',
    })
      .then((next) => {
        url = `${endpoint}?token=${next.token}`;
        if (abort.signal.aborted) return;
        setSession(next);
        void poll();
      })
      .catch((e) => {
        if (!abort.signal.aborted) setConnectionError(String(e));
      });
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [id]);

  const pageKey = page?.pageKey;
  useEffect(() => {
    setError(undefined);
    if (!pageKey || !session) return;
    const abort = new AbortController();
    void request<CameraMarkerDetection>(
      `${endpoint}?token=${session.token}&pageKey=${encodeURIComponent(pageKey)}`,
      { method: 'POST', signal: abort.signal },
    )
      .then((next) => {
        if (!abort.signal.aborted) finish.current(next);
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setError(error instanceof Error ? error.message : String(error));
      });
    return () => abort.abort();
  }, [session, pageKey, retry]);
  const url = chosen ?? session?.links[0]?.url;
  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      {connectionError && (
        <Alert showIcon type="error" message={connectionError} />
      )}
      <LiveCameraImage
        src={cameraPreviewUrl(id, 'raw', 'marker')}
        alt={name}
        style={{
          width: '100%',
          height: 'min(42vh,420px)',
          objectFit: 'contain',
        }}
      />
      {(!session ||
        (page && ['waiting', 'reconnecting'].includes(page.state))) &&
        (url ? (
          <Space wrap align="center">
            <QRCode value={url} size={148} />
            <Space direction="vertical">
              <Typography.Text>
                {zh
                  ? '用待识别的屏幕扫码连接。'
                  : 'Scan with the target screen to connect.'}
              </Typography.Text>
              {session && session.links.length > 1 && (
                <Select
                  aria-label={zh ? '标记页网络地址' : 'Marker page address'}
                  value={url}
                  options={session.links.map((l) => ({
                    value: l.url,
                    label: l.name,
                  }))}
                  onChange={setChosen}
                />
              )}
              <a href={url} target="_blank" rel="noreferrer">
                {zh ? '打开标记页' : 'Open marker page'}
              </a>
            </Space>
          </Space>
        ) : session ? (
          <Alert
            showIcon
            type="warning"
            message={
              zh
                ? '未找到手机可访问的局域网地址。'
                : 'No LAN address is available for the phone.'
            }
          />
        ) : (
          !connectionError && <Spin />
        ))}
      {page?.state === 'bounds' && (
        <output>
          {zh
            ? '请保持全屏并恢复正常缩放，等待可测量的屏幕范围。'
            : 'Keep the page in full screen at normal zoom so its bounds can be measured.'}
        </output>
      )}
      {page?.state === 'fullscreen' && (
        <output>
          {zh
            ? '等待手机进入全屏…'
            : 'Waiting for the phone to enter full screen…'}
        </output>
      )}
      {page?.state === 'home-screen' && (
        <output>
          {zh
            ? '请将标定页添加到主屏幕，再从主屏幕图标打开。'
            : 'Add the calibration page to the iOS Home Screen and open it from its icon.'}
        </output>
      )}
      {pageKey && !error && (
        <output>
          {zh ? '正在识别屏幕标记…' : 'Detecting screen markers…'}
        </output>
      )}
      {error && <Alert showIcon type="error" message={error} />}
      {error && pageKey && (
        <Button
          onClick={async () => {
            try {
              await request(`${endpoint}?token=${session!.token}&showMarkers`, {
                method: 'POST',
              });
              setRetry((v) => v + 1);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          {zh ? '重新识别' : 'Detect again'}
        </Button>
      )}
    </Space>
  );
}
