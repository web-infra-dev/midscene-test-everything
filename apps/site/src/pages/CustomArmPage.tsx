import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/translations';
import { HighlightCode } from '../utils/highlight';

const ADAPTER_SKELETON = `import {
  type CartesianPose,
  type MotionHandle,
  type MotionOptions,
  type RobotArmAdapter,
  type RobotDriver,
  type RobotKinematics,
  type RobotStatus,
  createMotionHandle,
} from '@midscene/arm-kit/adapter-development';

export class MyArmAdapter implements RobotArmAdapter {
  readonly contractVersion = 1 as const;
  readonly id = 'my-arm-4axis';
  readonly name = 'My Custom 4-Axis Arm';
  readonly connectionIdentity = 'tcp://192.168.1.100:29999';

  readonly readinessPolicy = {
    maxStateAgeMs: 1000,
    required: ['emergencyStop', 'protectiveStop'] as const,
  };

  readonly kinematics: RobotKinematics = {
    jointCount: 4,
    joints: [
      { name: 'J1', limit: { min: -160, max: 160 } },
      { name: 'J2', limit: { min: -25, max: 85 } },
      { name: 'J3', limit: { min: -25, max: 105 } },
      { name: 'J4', limit: { min: -180, max: 180 } },
    ],
  };

  readonly driver: RobotDriver = {
    connect: async () => { /* open socket */ },
    disconnect: async () => { /* close socket */ },
    stop: async () => { /* halt physical motion immediately */ },
    getState: async (): Promise<RobotStatus> => ({
      authority: 'controller',
      power: 'powered',
      enablement: 'enabled',
      motion: 'idle',
      operationMode: 'automatic',
      emergencyStop: 'inactive',
      protectiveStop: 'inactive',
      faults: [],
      quality: 'fresh',
    }),
    moveLinear: async (pose: CartesianPose, options: MotionOptions): Promise<MotionHandle> =>
      createMotionHandle(() => sendLinearMove(pose, options)),
    enterDragMode: async () => { /* optional: free-drive for calibration */ },
    exitDragMode: async () => { /* optional: lock servo */ },
  };
}`;

const VERIFY_SNIPPET = `import { createArmRuntime } from '@midscene/arm-kit';
import { MyArmAdapter } from './my-arm-adapter.js';

const runtime = createArmRuntime({
  adapter: new MyArmAdapter(),
});

// Verify adapter contract & run service:
// pnpm --filter @midscene/arm-kit test
// pnpm --filter @midscene/arm-service start
// pnpm dev:playground`;

export function CustomArmPage() {
  const { locale, t } = useI18n();
  const [activeId, setActiveId] = useState('arm-layers');
  const [codeTab, setCodeTab] = useState<'adapter' | 'verify'>('adapter');
  const [copied, setCopied] = useState(false);

  const copy =
    locale === 'zh'
      ? {
          eyebrow: 'SDK · ADAPTER DEVELOPMENT',
          title: 'Custom Robot Arm',
          meta: [
            { k: 'ENTRY', v: '@midscene/arm-kit/adapter-development' },
            { k: 'CONTRACT', v: 'v1' },
            { k: 'REF', v: 'packages/robot-arm/adapter-mg400' },
          ],
          toc: [
            { id: 'arm-layers', label: '01 分层职责' },
            { id: 'arm-contract', label: '02 接口契约' },
            { id: 'arm-skeleton', label: '03 实现与挂载' },
          ],
          s1Title: '01 分层职责',
          layers: [
            {
              tag: '01 · VENDOR',
              name: 'RobotArmAdapter',
              desc: '仅负责控制器通信、安全状态采样与线性/点位运动指令。',
            },
            {
              tag: '02 · RUNTIME',
              name: '@midscene/arm-kit',
              desc: '托管动作队列、像素到物理坐标标定、倾斜容差与就绪策略。',
            },
            {
              tag: '03 · PROTOCOL',
              name: '@midscene/arm-service',
              desc: '暴露标准 /api/v1/* 与 MCP，直接接入 Playground、SDK 与 Agent。',
            },
          ],
          s2Title: '02 RobotArmAdapter 契约',
          contractHeaders: ['成员', '要求'],
          contractRows: [
            ['contractVersion', '固定为 1。'],
            [
              'id / name / connectionIdentity',
              '设备唯一 ID、展示名称与连接标识。',
            ],
            ['kinematics', '声明关节数与各轴限位（JointDefinition）。'],
            [
              'readinessPolicy',
              '状态采样最大有效期（maxStateAgeMs）与必检安全项。',
            ],
            [
              'driver.connect / disconnect / stop / getState',
              '必需方法；SDK 退出时会自动触发 stop()。',
            ],
            [
              'driver.moveLinear / movePtp / moveJoints',
              '返回 MotionHandle；可选 enterDragMode() 支持拖拽示教标定。',
            ],
            [
              'latestMotionSample()',
              '可选被动采样接口，用于 3D 镜像渲染（禁止阻塞查询）。',
            ],
          ],
          s3Title: '03 实现与挂载',
        }
      : {
          eyebrow: 'SDK · ADAPTER DEVELOPMENT',
          title: 'Custom Robot Arm',
          meta: [
            { k: 'ENTRY', v: '@midscene/arm-kit/adapter-development' },
            { k: 'CONTRACT', v: 'v1' },
            { k: 'REF', v: 'packages/robot-arm/adapter-mg400' },
          ],
          toc: [
            { id: 'arm-layers', label: '01 Architecture' },
            { id: 'arm-contract', label: '02 Contract' },
            { id: 'arm-skeleton', label: '03 Implementation' },
          ],
          s1Title: '01 Architecture',
          layers: [
            {
              tag: '01 · VENDOR',
              name: 'RobotArmAdapter',
              desc: 'Translates controller sockets into pose/safety samples and linear/PTP moves.',
            },
            {
              tag: '02 · RUNTIME',
              name: '@midscene/arm-kit',
              desc: 'Owns action queueing, pixel-to-arm calibration, tilt limits, and readiness.',
            },
            {
              tag: '03 · PROTOCOL',
              name: '@midscene/arm-service',
              desc: 'Serves /api/v1/* and MCP for Playground, Midscene SDK, and coding agents.',
            },
          ],
          s2Title: '02 RobotArmAdapter Contract',
          contractHeaders: ['Member', 'Requirement'],
          contractRows: [
            ['contractVersion', 'Must be 1.'],
            [
              'id / name / connectionIdentity',
              'Stable ID, display name, and transport URI.',
            ],
            [
              'kinematics',
              'Joint count and per-joint limits (JointDefinition).',
            ],
            [
              'readinessPolicy',
              'Max sample age (maxStateAgeMs) and required safety interlocks.',
            ],
            [
              'driver.connect / disconnect / stop / getState',
              'Required lifecycle methods. SDK shutdown calls stop() automatically.',
            ],
            [
              'driver.moveLinear / movePtp / moveJoints',
              'Return a MotionHandle; optional enterDragMode() enables hand-guided calibration.',
            ],
            [
              'latestMotionSample()',
              'Optional passive sample reader for 3D mirror (never issue blocking queries).',
            ],
          ],
          s3Title: '03 Implementation & Runtime',
        };

  useEffect(() => {
    const ids = copy.toc.map((item) => item.id);
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
  }, [copy.toc]);

  const scrollTo = (id: string) => {
    setActiveId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  const activeCode = codeTab === 'adapter' ? ADAPTER_SKELETON : VERIFY_SNIPPET;

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
    <section className="doc-page">
      <header className="doc-hero">
        <p className="eyebrow">
          <i />
          {copy.eyebrow}
        </p>
        <h1>{copy.title}</h1>
        <div className="doc-meta-strip mono">
          {copy.meta.map((item) => (
            <span key={item.k}>
              <em>{item.k}</em> {item.v}
            </span>
          ))}
        </div>
      </header>

      <div className="doc-layout">
        <aside className="doc-toc" aria-label="Custom arm sections">
          {copy.toc.map((item) => (
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
          <section className="doc-section" id="arm-layers">
            <h2>{copy.s1Title}</h2>
            <div className="layer-grid">
              {copy.layers.map((layer) => (
                <article key={layer.tag} className="layer-card">
                  <span className="layer-tag">{layer.tag}</span>
                  <h3>{layer.name}</h3>
                  <p>{layer.desc}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="doc-section" id="arm-contract">
            <h2>{copy.s2Title}</h2>
            <div className="doc-table-wrap">
              <table className="doc-table">
                <thead>
                  <tr>
                    {copy.contractHeaders.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {copy.contractRows.map(([name, role]) => (
                    <tr key={name}>
                      <td>
                        <code>{name}</code>
                      </td>
                      <td>{role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="doc-section" id="arm-skeleton">
            <h2>{copy.s3Title}</h2>
            <figure className="codefig doc-codefig">
              <figcaption>
                <div className="code-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={codeTab === 'adapter'}
                    className={`code-tab${codeTab === 'adapter' ? ' active' : ''}`}
                    onClick={() => setCodeTab('adapter')}
                  >
                    my-arm-adapter.ts
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={codeTab === 'verify'}
                    className={`code-tab${codeTab === 'verify' ? ' active' : ''}`}
                    onClick={() => setCodeTab('verify')}
                  >
                    runtime.ts
                  </button>
                </div>
                <button className="copy-btn" type="button" onClick={handleCopy}>
                  {copied ? t.quickStart.copied : t.quickStart.copy}
                </button>
              </figcaption>
              <pre>
                <code>
                  <HighlightCode code={activeCode} lang="ts" />
                </code>
              </pre>
            </figure>
          </section>
        </div>
      </div>
    </section>
  );
}
