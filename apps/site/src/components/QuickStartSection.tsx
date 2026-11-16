import { useState } from 'react';
import { useI18n } from '../i18n/translations';

type CodeTab = 'server' | 'sdk';

const SERVER_RAW = `import { createDeviceHandler, type ControlledDevice } from '@midscene/universal-device/server';

const myDevice: ControlledDevice = {
  signal: new AbortController().signal,
  actions: ['Tap', 'Swipe', 'Input'],
  async screenshot() {
    return { base64: await captureFrame(), format: 'jpeg', width: 1179, height: 2556 };
  },
  async execute(action) {
    await sendHardwareCommand(action);
  },
};

export const handler = createDeviceHandler({
  token: process.env.MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN,
  listDevices: () => [{ id: 'my-device-1', name: 'Custom Rig', platform: 'hardware', status: 'available' }],
  readyDevice: async () => myDevice,
});`;

const SDK_RAW = `import { agentFromUniversalDevice } from '@midscene/universal-device';

const agent = await agentFromUniversalDevice({
  host: process.env.MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL || 'http://localhost:5801',
  deviceId: process.env.MIDSCENE_UNIVERSAL_DEVICE_ID,
});

await agent.aiTap('Tap the Allow button');
console.log(await agent.aiQuery('Summarize current screen state'));

await agent.destroy();`;

function ServerCodeHtml() {
  return (
    <>
      <span className="k">import</span> {'{ '}createDeviceHandler,{' '}
      <span className="k">type</span> ControlledDevice{' } '}
      <span className="k">from</span>{' '}
      <span className="s">'@midscene/universal-device/server'</span>;{'\n\n'}
      <span className="k">const</span> myDevice: ControlledDevice = {'{\n'}
      {'  '}signal: <span className="k">new</span>{' '}
      <span className="f">AbortController</span>().signal,{'\n'}
      {'  '}actions: [<span className="s">'Tap'</span>,{' '}
      <span className="s">'Swipe'</span>, <span className="s">'Input'</span>],
      {'\n'}
      {'  '}
      <span className="k">async</span> <span className="f">screenshot</span>(){' '}
      {'{\n'}
      {'    '}
      <span className="k">return</span> {'{ '}base64:{' '}
      <span className="k">await</span> <span className="f">captureFrame</span>
      (), format: <span className="s">'jpeg'</span>, width: 1179, height: 2556
      {' };\n'}
      {'  },\n'}
      {'  '}
      <span className="k">async</span> <span className="f">execute</span>
      (action) {'{\n'}
      {'    '}
      <span className="k">await</span>{' '}
      <span className="f">sendHardwareCommand</span>(action);{'\n'}
      {'  },\n'}
      {'};\n\n'}
      <span className="k">export const</span> handler ={' '}
      <span className="f">createDeviceHandler</span>({'{\n'}
      {'  '}token: process.env.MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN,{'\n'}
      {'  '}listDevices: () =&gt; [{'{ '}id:{' '}
      <span className="s">'my-device-1'</span>, name:{' '}
      <span className="s">'Custom Rig'</span>, platform:{' '}
      <span className="s">'hardware'</span>, status:{' '}
      <span className="s">'available'</span>
      {' }'}],{'\n'}
      {'  '}readyDevice: <span className="k">async</span> () =&gt; myDevice,
      {'\n'}
      {'});'}
    </>
  );
}

function SdkCodeHtml() {
  return (
    <>
      <span className="k">import</span> {'{ '}agentFromUniversalDevice{' } '}
      <span className="k">from</span>{' '}
      <span className="s">'@midscene/universal-device'</span>;{'\n\n'}
      <span className="k">const</span> agent = <span className="k">await</span>{' '}
      <span className="f">agentFromUniversalDevice</span>({'{\n'}
      {'  '}host: process.env.MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL ||{' '}
      <span className="s">'http://localhost:5801'</span>,{'\n'}
      {'  '}deviceId: process.env.MIDSCENE_UNIVERSAL_DEVICE_ID,{'\n'}
      {'});\n\n'}
      <span className="k">await</span> agent.<span className="f">aiTap</span>(
      <span className="s">'Tap the Allow button'</span>);{'\n'}
      console.<span className="f">log</span>(<span className="k">await</span>{' '}
      agent.<span className="f">aiQuery</span>(
      <span className="s">'Summarize current screen state'</span>));{'\n\n'}
      <span className="k">await</span> agent.<span className="f">destroy</span>
      ();
    </>
  );
}

export function QuickStartSection() {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState(0);
  const [codeTab, setCodeTab] = useState<CodeTab>('server');
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const raw = codeTab === 'server' ? SERVER_RAW : SDK_RAW;
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Ignore clipboard errors in restricted environments
    }
  };

  return (
    <section className="section-block" id="quickstart">
      <p className="eyebrow">
        <i />
        {t.quickStart.eyebrow}
      </p>
      <h2>{t.quickStart.heading}</h2>
      <p className="lede">{t.quickStart.lede}</p>

      <div className="qs-box">
        <div className="qs-tabs" role="tablist">
          {t.quickStart.tabs.map((label, idx) => (
            <button
              key={label}
              className={`tab-btn${activeTab === idx ? ' active' : ''}`}
              type="button"
              role="tab"
              aria-selected={activeTab === idx}
              onClick={() => setActiveTab(idx)}
            >
              <span className="tab-idx">{`0${idx + 1}`}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="qs-panel">
          <div className="steps">
            {t.quickStart.panels[activeTab].steps.map((step) => (
              <article key={step.num}>
                <span className="n">{step.num}</span>
                <h3>{step.title}</h3>
                {step.cmd && <p className="mono">{step.cmd}</p>}
                {step.desc && <p>{step.desc}</p>}
              </article>
            ))}
          </div>
        </div>
      </div>

      {activeTab === 2 && (
        <figure className="codefig">
          <figcaption>
            <div className="code-tabs" role="tablist">
              <button
                className={`code-tab${codeTab === 'server' ? ' active' : ''}`}
                type="button"
                role="tab"
                aria-selected={codeTab === 'server'}
                onClick={() => setCodeTab('server')}
              >
                {t.quickStart.codeTabs.server}
              </button>
              <button
                className={`code-tab${codeTab === 'sdk' ? ' active' : ''}`}
                type="button"
                role="tab"
                aria-selected={codeTab === 'sdk'}
                onClick={() => setCodeTab('sdk')}
              >
                {t.quickStart.codeTabs.sdk}
              </button>
            </div>
            <div className="code-meta">
              <span>
                {codeTab === 'server'
                  ? 'custom-device-server.ts'
                  : 'custom-device-agent.ts'}
              </span>
              <button className="copy-btn" type="button" onClick={handleCopy}>
                {copied ? t.quickStart.copied : t.quickStart.copy}
              </button>
            </div>
          </figcaption>
          <pre>
            <code>
              {codeTab === 'server' ? <ServerCodeHtml /> : <SdkCodeHtml />}
            </code>
          </pre>
        </figure>
      )}
    </section>
  );
}
