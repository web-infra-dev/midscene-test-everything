import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/translations';
import { HighlightCode } from '../utils/highlight';

interface EndpointSpec {
  id: string;
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  summary: string;
  params?: string[];
  requestCode?: string;
  responseLabel: string;
  responseCode: string;
}

function EndpointRow({ ep }: { ep: EndpointSpec }) {
  const { t } = useI18n();
  const hasReq = Boolean(ep.requestCode);
  const [tab, setTab] = useState<'req' | 'res'>(hasReq ? 'req' : 'res');
  const [copied, setCopied] = useState(false);

  const activeCode =
    tab === 'req' && ep.requestCode ? ep.requestCode : ep.responseCode;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard errors in restricted environments
    }
  };

  return (
    <article className="api-row" id={ep.id}>
      <div className="api-row-info">
        <div className="api-row-head">
          <span className={`method-badge method-${ep.method.toLowerCase()}`}>
            {ep.method}
          </span>
          <code className="api-path">{ep.path}</code>
        </div>
        <p className="api-row-desc">{ep.summary}</p>
        {ep.params && ep.params.length > 0 && (
          <div className="api-param-pills mono">
            {ep.params.map((p) => (
              <span key={p}>{p}</span>
            ))}
          </div>
        )}
      </div>

      <figure className="codefig doc-codefig">
        <figcaption>
          <div className="code-tabs">
            {hasReq && (
              <button
                type="button"
                className={`code-tab${tab === 'req' ? ' active' : ''}`}
                onClick={() => setTab('req')}
              >
                Request
              </button>
            )}
            <button
              type="button"
              className={`code-tab${tab === 'res' ? ' active' : ''}`}
              onClick={() => setTab('res')}
            >
              {ep.responseLabel}
            </button>
          </div>
          <button className="copy-btn" type="button" onClick={handleCopy}>
            {copied ? t.quickStart.copied : t.quickStart.copy}
          </button>
        </figcaption>
        <pre>
          <code>
            <HighlightCode code={activeCode} lang="json" />
          </code>
        </pre>
      </figure>
    </article>
  );
}

const API_CONTENT = {
  en: {
    eyebrow: 'PROTOCOL · /api/v1',
    title: 'Universal Device API',
    meta: [
      { k: 'AUTH', v: 'Bearer <token>' },
      { k: 'LEASE', v: '30s default (5s–300s)' },
      { k: 'OPENAPI', v: 'GET /api/openapi.json' },
    ],
    flow: [
      '01 GET /devices',
      '02 POST /sessions',
      '03 screenshot · actions',
      '04 DELETE /sessions/:id',
    ],
    toc: [
      { id: 'discovery', label: '01 Discovery' },
      { id: 'sessions', label: '02 Sessions' },
      { id: 'perception', label: '03 Perception' },
      { id: 'actions', label: '04 Actions' },
      { id: 'errors', label: '05 Errors' },
    ],
    sections: {
      discovery: '01 Discovery & Health',
      sessions: '02 Session & Lease',
      perception: '03 Perception',
      actions: '04 Input Actions',
      errors: '05 Error Model',
    },
    endpoints: [
      {
        id: 'ep-healthz',
        method: 'GET',
        path: '/healthz',
        summary: 'Unauthenticated liveness probe.',
        responseLabel: '200 OK',
        responseCode: `{ "ok": true }`,
      },
      {
        id: 'ep-devices',
        method: 'GET',
        path: '/api/v1/devices',
        summary:
          'List configured devices, readiness status, screen source, and supported actions.',
        params: [
          'status: available | busy | offline',
          'screenSource: usb | camera | airplay',
        ],
        responseLabel: '200 OK',
        responseCode: `{
  "devices": [
    {
      "id": "mg400-1",
      "name": "DOBOT MG400",
      "status": "available",
      "screenSource": "camera",
      "actions": ["tap", "doubleTap", "longPress", "swipe", "dragAndDrop"],
      "preview": "mjpeg"
    }
  ]
}`,
      },
      {
        id: 'ep-create-session',
        method: 'POST',
        path: '/api/v1/sessions',
        summary: 'Acquire exclusive lease on a ready device.',
        params: ['deviceId: string', 'leaseMs?: 5000..300000'],
        requestCode: `{
  "deviceId": "mg400-1",
  "leaseMs": 30000
}`,
        responseLabel: '201 Created',
        responseCode: `{
  "id": "sess_01J9...",
  "deviceId": "mg400-1",
  "expiresInMs": 30000
}`,
      },
      {
        id: 'ep-heartbeat',
        method: 'POST',
        path: '/api/v1/sessions/:id/heartbeat',
        summary: 'Renew active lease before expiresInMs elapses.',
        responseLabel: '200 OK',
        responseCode: `{ "ok": true }`,
      },
      {
        id: 'ep-release',
        method: 'DELETE',
        path: '/api/v1/sessions/:id',
        summary: 'Release lease and return device to available.',
        responseLabel: '200 OK',
        responseCode: `{ "ok": true }`,
      },
      {
        id: 'ep-screenshot',
        method: 'GET',
        path: '/api/v1/sessions/:id/screenshot',
        summary:
          'Capture current frame as JSON base64 or raw JPEG when Accept: image/jpeg is sent.',
        params: ['Accept: application/json | image/jpeg'],
        responseLabel: '200 OK',
        responseCode: `{
  "jpeg": "/9j/4AAQSkZJRgABAQ...",
  "width": 1179,
  "height": 2556,
  "sequence": 42,
  "receivedAt": 1731740000123
}`,
      },
      {
        id: 'ep-preview',
        method: 'GET',
        path: '/api/v1/sessions/:id/preview',
        summary: 'Stream live MJPEG frames for Playground or inspection.',
        responseLabel: '200 Stream',
        responseCode: 'Content-Type: multipart/x-mixed-replace; boundary=frame',
      },
      {
        id: 'ep-actions',
        method: 'POST',
        path: '/api/v1/sessions/:id/actions',
        summary:
          'Execute one InputAction. Coordinates are in screenshot pixels.',
        params: ['Point: { x: number, y: number }', 'durationMs?: 0..5000'],
        requestCode: `{
  "type": "tap",
  "point": { "x": 448, "y": 316 }
}`,
        responseLabel: '200 OK',
        responseCode: `{ "ok": true }`,
      },
    ] as EndpointSpec[],
    actionTableHeaders: ['type', 'Fields', 'Behavior'],
    actionsList: [
      { type: 'tap / doubleTap', fields: 'point', desc: 'Tap or double-tap.' },
      {
        type: 'longPress',
        fields: 'point, durationMs?',
        desc: 'Press & hold (0–5000 ms).',
      },
      {
        type: 'swipe / dragAndDrop',
        fields: 'from, to, durationMs?',
        desc: 'Linear gesture between two points.',
      },
      {
        type: 'scroll',
        fields: "direction: 'up' | 'down', steps?, point?",
        desc: 'Scroll (steps 1–24).',
      },
      {
        type: 'typeText',
        fields: 'text, replace?',
        desc: 'Input text (max 8192 chars).',
      },
      { type: 'key', fields: 'key', desc: 'Press key (1–128 chars).' },
      {
        type: 'home / back / clearInput',
        fields: '—',
        desc: 'System navigation or clear field.',
      },
    ],
    errorHeaders: ['code', 'HTTP', 'Meaning'],
    errors: [
      {
        code: 'UNAUTHORIZED',
        http: '401',
        desc: 'Missing or invalid Bearer token.',
      },
      {
        code: 'INVALID_REQUEST',
        http: '400',
        desc: 'Malformed JSON or schema error.',
      },
      {
        code: 'NOT_FOUND',
        http: '404',
        desc: 'Unknown route or preview disabled.',
      },
      {
        code: 'DEVICE_BUSY',
        http: '409',
        desc: 'Device held by another session.',
      },
      {
        code: 'DEVICE_OFFLINE',
        http: '409',
        desc: 'Hardware disconnected or uncalibrated.',
      },
      {
        code: 'ACTION_IN_PROGRESS',
        http: '409',
        desc: 'Previous action still running.',
      },
      {
        code: 'ACTION_FAILED',
        http: '409',
        desc: 'Hardware execution failed.',
      },
      {
        code: 'SESSION_EXPIRED',
        http: '410',
        desc: 'Lease expired or released.',
      },
      {
        code: 'ACTION_UNSUPPORTED',
        http: '422',
        desc: 'Action not in device.actions.',
      },
      {
        code: 'SERVICE_UNAVAILABLE',
        http: '503',
        desc: 'Service stopping, updating, or backend down.',
      },
    ],
  },
  zh: {
    eyebrow: 'PROTOCOL · /api/v1',
    title: 'Universal Device API',
    meta: [
      { k: 'AUTH', v: 'Bearer <token>' },
      { k: 'LEASE', v: '默认 30s (5s–300s)' },
      { k: 'OPENAPI', v: 'GET /api/openapi.json' },
    ],
    flow: [
      '01 GET /devices',
      '02 POST /sessions',
      '03 screenshot · actions',
      '04 DELETE /sessions/:id',
    ],
    toc: [
      { id: 'discovery', label: '01 设备发现' },
      { id: 'sessions', label: '02 会话租约' },
      { id: 'perception', label: '03 画面采集' },
      { id: 'actions', label: '04 动作执行' },
      { id: 'errors', label: '05 错误码' },
    ],
    sections: {
      discovery: '01 设备发现与健康检查',
      sessions: '02 会话与独占租约',
      perception: '03 画面采集与预览',
      actions: '04 交互动作执行',
      errors: '05 错误码规范',
    },
    endpoints: [
      {
        id: 'ep-healthz',
        method: 'GET',
        path: '/healthz',
        summary: '免鉴权存活探针。',
        responseLabel: '200 OK',
        responseCode: `{ "ok": true }`,
      },
      {
        id: 'ep-devices',
        method: 'GET',
        path: '/api/v1/devices',
        summary: '获取已配置设备、在线状态、画面来源及支持的动作列表。',
        params: [
          'status: available | busy | offline',
          'screenSource: usb | camera | airplay',
        ],
        responseLabel: '200 OK',
        responseCode: `{
  "devices": [
    {
      "id": "mg400-1",
      "name": "DOBOT MG400",
      "status": "available",
      "screenSource": "camera",
      "actions": ["tap", "doubleTap", "longPress", "swipe", "dragAndDrop"],
      "preview": "mjpeg"
    }
  ]
}`,
      },
      {
        id: 'ep-create-session',
        method: 'POST',
        path: '/api/v1/sessions',
        summary: '申请设备独占租约。',
        params: ['deviceId: string', 'leaseMs?: 5000..300000'],
        requestCode: `{
  "deviceId": "mg400-1",
  "leaseMs": 30000
}`,
        responseLabel: '201 Created',
        responseCode: `{
  "id": "sess_01J9...",
  "deviceId": "mg400-1",
  "expiresInMs": 30000
}`,
      },
      {
        id: 'ep-heartbeat',
        method: 'POST',
        path: '/api/v1/sessions/:id/heartbeat',
        summary: '在租约过期前刷新有效期。',
        responseLabel: '200 OK',
        responseCode: `{ "ok": true }`,
      },
      {
        id: 'ep-release',
        method: 'DELETE',
        path: '/api/v1/sessions/:id',
        summary: '主动释放会话租约，恢复设备为可用状态。',
        responseLabel: '200 OK',
        responseCode: `{ "ok": true }`,
      },
      {
        id: 'ep-screenshot',
        method: 'GET',
        path: '/api/v1/sessions/:id/screenshot',
        summary:
          '获取当前帧。默认返回 JSON Base64；传入 Accept: image/jpeg 返回二进制流。',
        params: ['Accept: application/json | image/jpeg'],
        responseLabel: '200 OK',
        responseCode: `{
  "jpeg": "/9j/4AAQSkZJRgABAQ...",
  "width": 1179,
  "height": 2556,
  "sequence": 42,
  "receivedAt": 1731740000123
}`,
      },
      {
        id: 'ep-preview',
        method: 'GET',
        path: '/api/v1/sessions/:id/preview',
        summary: '输出实时 MJPEG 画面流，供 Playground 预览。',
        responseLabel: '200 Stream',
        responseCode: 'Content-Type: multipart/x-mixed-replace; boundary=frame',
      },
      {
        id: 'ep-actions',
        method: 'POST',
        path: '/api/v1/sessions/:id/actions',
        summary: '执行单次 InputAction，坐标使用当前截图的像素坐标。',
        params: ['Point: { x: number, y: number }', 'durationMs?: 0..5000'],
        requestCode: `{
  "type": "tap",
  "point": { "x": 448, "y": 316 }
}`,
        responseLabel: '200 OK',
        responseCode: `{ "ok": true }`,
      },
    ] as EndpointSpec[],
    actionTableHeaders: ['type', '字段', '行为'],
    actionsList: [
      {
        type: 'tap / doubleTap',
        fields: 'point',
        desc: '单击或双击像素坐标。',
      },
      {
        type: 'longPress',
        fields: 'point, durationMs?',
        desc: '长按（0–5000 ms）。',
      },
      {
        type: 'swipe / dragAndDrop',
        fields: 'from, to, durationMs?',
        desc: '两点间滑动或拖拽。',
      },
      {
        type: 'scroll',
        fields: "direction: 'up' | 'down', steps?, point?",
        desc: '方向滚动（steps 1–24）。',
      },
      {
        type: 'typeText',
        fields: 'text, replace?',
        desc: '输入文本（最长 8192 字符）。',
      },
      { type: 'key', fields: 'key', desc: '触发按键（1–128 字符）。' },
      {
        type: 'home / back / clearInput',
        fields: '—',
        desc: '系统导航或清空输入框。',
      },
    ],
    errorHeaders: ['code', 'HTTP', '说明'],
    errors: [
      {
        code: 'UNAUTHORIZED',
        http: '401',
        desc: '缺少或无效的 Bearer Token。',
      },
      {
        code: 'INVALID_REQUEST',
        http: '400',
        desc: 'JSON 格式或参数校验失败。',
      },
      { code: 'NOT_FOUND', http: '404', desc: '路径不存在或未开启预览流。' },
      { code: 'DEVICE_BUSY', http: '409', desc: '设备已被其他会话占用。' },
      { code: 'DEVICE_OFFLINE', http: '409', desc: '硬件未连接或未完成标定。' },
      { code: 'ACTION_IN_PROGRESS', http: '409', desc: '上一条动作仍在执行。' },
      { code: 'ACTION_FAILED', http: '409', desc: '硬件执行失败或超时。' },
      { code: 'SESSION_EXPIRED', http: '410', desc: '会话租约已过期或释放。' },
      {
        code: 'ACTION_UNSUPPORTED',
        http: '422',
        desc: '设备未声明支持该动作。',
      },
      {
        code: 'SERVICE_UNAVAILABLE',
        http: '503',
        desc: '服务停止、更新中或后端不可用。',
      },
    ],
  },
};

export function ApiPage() {
  const { locale } = useI18n();
  const c = API_CONTENT[locale];
  const [activeId, setActiveId] = useState('discovery');

  useEffect(() => {
    const ids = c.toc.map((item) => item.id);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: '-20% 0px -65% 0px' },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [c.toc]);

  const scrollTo = (id: string) => {
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <section className="doc-page">
      <header className="doc-hero">
        <p className="eyebrow">
          <i />
          {c.eyebrow}
        </p>
        <h1>{c.title}</h1>
        <div className="doc-meta-strip mono">
          {c.meta.map((item) => (
            <span key={item.k}>
              <em>{item.k}</em> {item.v}
            </span>
          ))}
        </div>
      </header>

      <div className="doc-layout">
        <aside className="doc-toc" aria-label="API sections">
          {c.toc.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`doc-toc-link${activeId === item.id ? ' active' : ''}`}
              onClick={() => scrollTo(item.id)}
            >
              {item.label}
            </button>
          ))}
        </aside>

        <div className="doc-main">
          <div className="doc-flow-strip mono" aria-label="Session lifecycle">
            {c.flow.map((step, idx) => (
              <span key={step} className="doc-flow-step">
                {step}
                {idx < c.flow.length - 1 && (
                  <span className="doc-flow-arrow" aria-hidden="true">
                    →
                  </span>
                )}
              </span>
            ))}
          </div>

          <section className="doc-section" id="discovery">
            <h2>{c.sections.discovery}</h2>
            {c.endpoints.slice(0, 2).map((ep) => (
              <EndpointRow key={ep.id} ep={ep} />
            ))}
          </section>

          <section className="doc-section" id="sessions">
            <h2>{c.sections.sessions}</h2>
            {c.endpoints.slice(2, 5).map((ep) => (
              <EndpointRow key={ep.id} ep={ep} />
            ))}
          </section>

          <section className="doc-section" id="perception">
            <h2>{c.sections.perception}</h2>
            {c.endpoints.slice(5, 7).map((ep) => (
              <EndpointRow key={ep.id} ep={ep} />
            ))}
          </section>

          <section className="doc-section" id="actions">
            <h2>{c.sections.actions}</h2>
            <EndpointRow ep={c.endpoints[7]} />
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr>
                    {c.actionTableHeaders.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.actionsList.map((a) => (
                    <tr key={a.type}>
                      <td>
                        <code>{a.type}</code>
                      </td>
                      <td>
                        <code>{a.fields}</code>
                      </td>
                      <td>{a.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="doc-section" id="errors">
            <h2>{c.sections.errors}</h2>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr>
                    {c.errorHeaders.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {c.errors.map((err) => (
                    <tr key={err.code}>
                      <td>
                        <code>{err.code}</code>
                      </td>
                      <td>
                        <span className="http-pill mono">{err.http}</span>
                      </td>
                      <td>{err.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
