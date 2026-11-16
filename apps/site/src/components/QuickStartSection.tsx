import { useState } from 'react';
import { useI18n } from '../i18n/translations';
import {
  HighlightCode,
  type HighlightLang,
  HighlightShellLines,
} from '../utils/highlight';

type AgentTab = 'codex' | 'claude' | 'cursor' | 'cli';
type CustomTab = 'server' | 'sdk';

const MG400_LINES = [
  'git clone https://github.com/web-infra-dev/midscene-robotics.git',
  'cd midscene-robotics && pnpm install && pnpm build',
  'pnpm --filter @midscene/arm-service start',
  'pnpm dev:playground',
];

const AIRLINK_LINES = [
  'npx -y @midscene/ios-airlink install',
  'npx -y @midscene/universal-device-playground',
];

const AGENT_SNIPPETS: Record<
  AgentTab,
  { file: string; lang: HighlightLang; code: string }
> = {
  codex: {
    file: '~/.codex/config.toml',
    lang: 'toml',
    code: `[mcp_servers.universal-device]
command = "npx"
args = ["-y", "@midscene/universal-device", "mcp"]

[mcp_servers.universal-device.env]
MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL = "<your-device-service-url>"
MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN = "<your-service-token>"`,
  },
  claude: {
    file: 'terminal',
    lang: 'shell',
    code: `claude mcp add universal-device \\
  -e MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL=<your-device-service-url> \\
  -e MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN=<your-service-token> \\
  -- npx -y @midscene/universal-device mcp`,
  },
  cursor: {
    file: '.cursor/mcp.json',
    lang: 'json',
    code: `{
  "mcpServers": {
    "universal-device": {
      "command": "npx",
      "args": ["-y", "@midscene/universal-device", "mcp"],
      "env": {
        "MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL": "<your-device-service-url>",
        "MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN": "<your-service-token>"
      }
    }
  }
}`,
  },
  cli: {
    file: 'SKILL.md + CLI',
    lang: 'shell',
    code: `npx -y @midscene/universal-device devices
npx -y @midscene/universal-device acquire --device <id>
npx -y @midscene/universal-device screenshot --session <sid>`,
  },
};

const CUSTOM_SNIPPETS: Record<CustomTab, { file: string; code: string }> = {
  server: {
    file: 'server.ts',
    code: `import { createDeviceHandler } from '@midscene/universal-device/server';

export const handler = createDeviceHandler({
  token: process.env.DEVICE_TOKEN,
  listDevices: () => [
    { id: 'rig-1', name: 'Custom Rig', status: 'available', actions: ['tap'] },
  ],
  readyDevice: async () => ({
    signal: new AbortController().signal,
    actions: ['tap', 'swipe'],
    screenshot: async () => ({
      base64: await captureFrame(),
      format: 'jpeg',
      width: 1179,
      height: 2556,
    }),
    execute: async (action) => sendToHardware(action),
  }),
});`,
  },
  sdk: {
    file: 'agent.ts',
    code: `import { agentFromUniversalDevice } from '@midscene/universal-device';

const agent = await agentFromUniversalDevice({
  host: '<your-device-service-url>',
  deviceId: 'rig-1',
});

await agent.aiTap('Allow');
await agent.destroy();`,
  },
};

function MacDots() {
  return (
    <span className="mac-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

function CopyBtn({ text }: { text: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore clipboard errors in restricted environments
    }
  };

  return (
    <button
      className={`copy-icon-btn${copied ? ' is-copied' : ''}`}
      type="button"
      onClick={handleCopy}
      aria-label={copied ? t.quickStart.copied : t.quickStart.copy}
      title={copied ? t.quickStart.copied : t.quickStart.copy}
    >
      {copied ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
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
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

function TerminalLines({ lines }: { lines: string[] }) {
  return (
    <pre>
      <code>
        <HighlightShellLines lines={lines} />
      </code>
    </pre>
  );
}

export function QuickStartSection() {
  const { t } = useI18n();
  const [agentTab, setAgentTab] = useState<AgentTab>('codex');
  const [customTab, setCustomTab] = useState<CustomTab>('server');

  const items = t.quickStart.items;

  return (
    <section className="section-block qs-section" id="quickstart">
      <div className="qs-header">
        <p className="eyebrow">
          <i />
          {t.quickStart.eyebrow}
        </p>
      </div>

      <div className="qs-list">
        {/* 01 DOBOT MG400 */}
        <article className="qs-row">
          <div className="qs-row-info">
            <span className="qs-row-num mono">{items[0].num}</span>
            <h3>{items[0].title}</h3>
            <p>{items[0].subtitle}</p>
          </div>
          <figure className="codefig mac-win qs-row-code">
            <figcaption>
              <div className="mac-win-left">
                <MacDots />
                <span className="qs-file mono">zsh — arm-service</span>
              </div>
              <CopyBtn text={MG400_LINES.join('\n')} />
            </figcaption>
            <TerminalLines lines={MG400_LINES} />
          </figure>
        </article>

        {/* 02 iOS AirLink */}
        <article className="qs-row">
          <div className="qs-row-info">
            <span className="qs-row-num mono">{items[1].num}</span>
            <h3>{items[1].title}</h3>
            <p>{items[1].subtitle}</p>
          </div>
          <figure className="codefig mac-win qs-row-code">
            <figcaption>
              <div className="mac-win-left">
                <MacDots />
                <span className="qs-file mono">zsh — ios-airlink</span>
              </div>
              <CopyBtn text={AIRLINK_LINES.join('\n')} />
            </figcaption>
            <TerminalLines lines={AIRLINK_LINES} />
          </figure>
        </article>

        {/* 03 MCP & Skills */}
        <article className="qs-row">
          <div className="qs-row-info">
            <span className="qs-row-num mono">{items[2].num}</span>
            <h3>{items[2].title}</h3>
            <p>{items[2].subtitle}</p>
          </div>
          <figure className="codefig mac-win qs-row-code">
            <figcaption>
              <div className="mac-win-left">
                <MacDots />
                <div className="code-tabs" role="tablist">
                  {(
                    [
                      ['codex', 'Codex'],
                      ['claude', 'Claude'],
                      ['cursor', 'Cursor'],
                      ['cli', 'CLI'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={agentTab === key}
                      className={`code-tab${agentTab === key ? ' active' : ''}`}
                      onClick={() => setAgentTab(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="code-meta">
                <span className="qs-file mono">
                  {AGENT_SNIPPETS[agentTab].file}
                </span>
                <CopyBtn text={AGENT_SNIPPETS[agentTab].code} />
              </div>
            </figcaption>
            <pre>
              <code>
                <HighlightCode
                  code={AGENT_SNIPPETS[agentTab].code}
                  lang={AGENT_SNIPPETS[agentTab].lang}
                />
              </code>
            </pre>
          </figure>
        </article>

        {/* 04 Custom Device */}
        <article className="qs-row">
          <div className="qs-row-info">
            <span className="qs-row-num mono">{items[3].num}</span>
            <h3>{items[3].title}</h3>
            <p>{items[3].subtitle}</p>
          </div>
          <figure className="codefig mac-win qs-row-code">
            <figcaption>
              <div className="mac-win-left">
                <MacDots />
                <div className="code-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={customTab === 'server'}
                    className={`code-tab${customTab === 'server' ? ' active' : ''}`}
                    onClick={() => setCustomTab('server')}
                  >
                    {t.quickStart.codeTabs.server}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={customTab === 'sdk'}
                    className={`code-tab${customTab === 'sdk' ? ' active' : ''}`}
                    onClick={() => setCustomTab('sdk')}
                  >
                    {t.quickStart.codeTabs.sdk}
                  </button>
                </div>
              </div>
              <div className="code-meta">
                <span className="qs-file mono">
                  {CUSTOM_SNIPPETS[customTab].file}
                </span>
                <CopyBtn text={CUSTOM_SNIPPETS[customTab].code} />
              </div>
            </figcaption>
            <pre>
              <code>
                <HighlightCode
                  code={CUSTOM_SNIPPETS[customTab].code}
                  lang="ts"
                />
              </code>
            </pre>
          </figure>
        </article>
      </div>
    </section>
  );
}
