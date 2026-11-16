import { useState } from 'react';
import { useI18n } from '../i18n/translations';

const NODE_Y = [28, 128, 228];

function ConsumerIcon({ index }: { index: number }) {
  if (index === 0) {
    return (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  }
  if (index === 1) {
    return (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
      </svg>
    );
  }
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
    </svg>
  );
}

function AdapterIcon({ index }: { index: number }) {
  if (index === 0) {
    return (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="7" y="2" width="10" height="20" rx="2" />
        <line x1="11" y1="18" x2="13" y2="18" />
      </svg>
    );
  }
  if (index === 1) {
    return (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M5 20h14" />
        <path d="M9 20v-4l5-6 4 2" />
        <circle cx="14" cy="10" r="2" />
        <circle cx="9" cy="16" r="1.5" />
      </svg>
    );
  }
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
    </svg>
  );
}

function HubCurves({
  side,
  activeIndex,
  allActive,
}: {
  side: 'left' | 'right';
  activeIndex: number | null;
  allActive: boolean;
}) {
  return (
    <svg
      className="proto-curves"
      viewBox="0 0 100 256"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {NODE_Y.map((y, idx) => {
        const d =
          side === 'left'
            ? `M 0 ${y} C 52 ${y}, 48 128, 100 128`
            : `M 0 128 C 52 128, 48 ${y}, 100 ${y}`;
        const active = allActive || activeIndex === idx;
        return (
          <g key={y}>
            <path className="proto-curve-base" d={d} />
            <path
              className={`proto-curve-flow${active ? ' active' : ''}`}
              d={d}
            />
            {active && (
              <circle r="2.2" className="proto-pulse">
                <animateMotion
                  dur={`${1.9 + idx * 0.25}s`}
                  repeatCount="indefinite"
                  path={d}
                />
              </circle>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function ProtocolDiagram() {
  const { t } = useI18n();
  const [hovered, setHovered] = useState<{
    side: 'left' | 'right';
    index: number;
  } | null>(null);

  return (
    <div className="proto-stage">
      <div className="proto-diagram">
        <div className="proto-col">
          <div className="proto-nodes">
            {t.protocol.diagram.consumers.map((label, idx) => {
              const isActive =
                hovered?.side === 'left' && hovered.index === idx;
              return (
                <div
                  className={`proto-node${isActive ? ' active' : ''}`}
                  key={label}
                  onMouseEnter={() => setHovered({ side: 'left', index: idx })}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className="proto-node-icon">
                    <ConsumerIcon index={idx} />
                  </span>
                  <strong>{label}</strong>
                </div>
              );
            })}
          </div>
        </div>

        <HubCurves
          side="left"
          activeIndex={hovered?.side === 'left' ? hovered.index : null}
          allActive={hovered === null || hovered.side === 'right'}
        />

        <div className={`proto-hub${hovered ? ' active' : ''}`}>
          <div className="proto-hub-ring" aria-hidden="true" />
          <div className="proto-hub-head">
            <span className="status-dot" />
            <h3>{t.protocol.diagram.hubTitle}</h3>
          </div>
          <div className="proto-hub-pills mono">
            <span>HTTP /api/v1</span>
            <span>MCP</span>
          </div>
        </div>

        <HubCurves
          side="right"
          activeIndex={hovered?.side === 'right' ? hovered.index : null}
          allActive={hovered === null || hovered.side === 'left'}
        />

        <div className="proto-col">
          <div className="proto-nodes">
            {t.protocol.diagram.adapters.map((label, idx) => {
              const isActive =
                hovered?.side === 'right' && hovered.index === idx;
              return (
                <div
                  className={`proto-node${isActive ? ' active' : ''}`}
                  key={label}
                  onMouseEnter={() => setHovered({ side: 'right', index: idx })}
                  onMouseLeave={() => setHovered(null)}
                >
                  <span className="proto-node-icon">
                    <AdapterIcon index={idx} />
                  </span>
                  <strong>{label}</strong>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
