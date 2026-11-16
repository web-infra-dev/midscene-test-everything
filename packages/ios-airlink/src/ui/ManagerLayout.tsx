import { Button, message } from 'antd';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import MidsceneLogo from './assets/midscene-logo.svg?react';
import { useI18n } from './i18n';

async function fetchAccessToken() {
  const response = await fetch('/ios-airlink/token', {
    headers: { 'X-Midscene-Playground': 'workspace' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Failed to load access token');
  const data = (await response.json()) as { token?: string };
  if (!data.token) throw new Error('Missing access token');
  return data.token;
}

function copyWithTextarea(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    return document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

export function ManagerLayout({
  adding,
  onAdd,
  showAdd = true,
  children,
}: {
  adding: boolean;
  onAdd: () => void;
  showAdd?: boolean;
  children: ReactNode;
}) {
  const { locale, toggleLocale, t } = useI18n();
  const tokenRef = useRef<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let active = true;
    void fetchAccessToken()
      .then((value) => {
        if (active) tokenRef.current = value;
      })
      .catch(() => {});
    return () => {
      active = false;
      clearTimeout(copiedTimer.current);
    };
  }, []);

  const copyToken = async () => {
    try {
      let token = tokenRef.current;
      if (!token) {
        token = await fetchAccessToken();
        tokenRef.current = token;
      }
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(token);
        } catch {
          if (!copyWithTextarea(token))
            throw new Error('Clipboard unavailable');
        }
      } else if (!copyWithTextarea(token)) {
        throw new Error('Clipboard unavailable');
      }
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
      void message.success(t('已复制 Token', 'Copied token'));
    } catch {
      void message.warning(
        t('复制 Token 失败，请重试', 'Failed to copy token'),
      );
    }
  };

  return (
    <div className="ios-airlink-shell">
      <header className="ios-airlink-topbar">
        <div className="ios-airlink-topbar-brand">
          <MidsceneLogo className="ios-airlink-topbar-logo" />
          <span className="ios-airlink-topbar-title">Midscene iOS AirLink</span>
        </div>
        <div className="ios-airlink-topbar-actions">
          <Button
            size="small"
            className="ios-airlink-outline-btn"
            onClick={toggleLocale}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M3.6 9h16.8M3.6 15h16.8" />
              <path d="M12 3a13.5 13.5 0 0 0 0 18M12 3a13.5 13.5 0 0 1 0 18" />
            </svg>
            {locale === 'zh' ? 'EN' : '中文'}
          </Button>
          <Button
            size="small"
            className="ios-airlink-outline-btn"
            onClick={() => void copyToken()}
          >
            {copied ? (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m5 12 4.5 4.5L19 7" />
              </svg>
            ) : (
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="7.5" cy="15.5" r="4.5" />
                <path d="m10.7 12.3 9.3-9.3M16 7l3 3M18.5 4.5 21 7" />
              </svg>
            )}
            {t('复制 Token', 'Copy Token')}
          </Button>
          <Button
            size="small"
            className="ios-airlink-outline-btn"
            href="/api/docs/"
            target="_blank"
            rel="noreferrer"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            {t('API 文档', 'API Docs')}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M7 17 17 7M9 7h8v8" />
            </svg>
          </Button>
          {showAdd && (
            <Button
              type="primary"
              size="small"
              className="ios-airlink-primary-btn"
              loading={adding}
              onClick={onAdd}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              {t('添加设备', 'Add Device')}
            </Button>
          )}
        </div>
      </header>

      <main className="ios-airlink-grid-main">{children}</main>
    </div>
  );
}
