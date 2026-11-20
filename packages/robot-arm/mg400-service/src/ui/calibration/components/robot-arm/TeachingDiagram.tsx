import { useId } from 'react';
import { t, useLanguage } from '../../i18n';
import type { InstallationTeachingPoint } from '../../robot-arm-api';

export const teachingIllustrationCopyKeys = [
  'Reference travel height — side view',
  'Camera-side boundary — top view',
  'Minimum Travel Height',
  'Reference Position',
  'Camera-side Boundary',
  'Keep the whole arm clear',
  'Forbidden side',
  'Allowed side',
  'Camera',
  'Screen',
] as const;

/** Same editable, localized artwork and materials as the setup illustrations. */
export function TeachingDiagram({
  stage,
}: { stage: InstallationTeachingPoint }) {
  useLanguage();
  const id = useId().replace(/:/g, '');
  const boundary = stage !== 'reference';
  const title = boundary
    ? 'Camera-side boundary — top view'
    : 'Reference travel height — side view';
  return (
    <svg
      className="robot-setup-illustration"
      viewBox="0 0 640 400"
      role="img"
      aria-label={t(title)}
      focusable={false}
    >
      <title>{t(title)}</title>
      <defs>
        <linearGradient id={`${id}-metal`} x2="0" y2="1">
          <stop stopColor="#edf1f7" />
          <stop offset="1" stopColor="#b6c2d3" />
        </linearGradient>
        <linearGradient id={`${id}-glass`} x2="1" y2="1">
          <stop stopColor="#eef5ff" />
          <stop offset="1" stopColor="#d8e7ff" />
        </linearGradient>
        <marker
          id={`${id}-arrow`}
          viewBox="0 0 10 10"
          refX="5"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0L10 5L0 10" fill="#4778e8" />
        </marker>
        <filter
          id={`${id}-shadow`}
          x="-30%"
          y="-30%"
          width="160%"
          height="180%"
        >
          <feDropShadow
            dx="0"
            dy="9"
            stdDeviation="10"
            floodColor="#263c66"
            floodOpacity=".1"
          />
        </filter>
      </defs>
      <rect
        width="640"
        height="400"
        rx="20"
        fill="var(--midscene-surface-muted)"
      />
      <text x="28" y="38" className="setup-art-title">
        {t(title)}
      </text>
      {boundary ? (
        <>
          <rect
            x="28"
            y="66"
            width="584"
            height="108"
            rx="12"
            fill="var(--diagram-forbidden)"
          />
          <rect
            x="28"
            y="184"
            width="584"
            height="186"
            rx="12"
            fill="var(--diagram-allowed)"
          />
          <g filter={`url(#${id}-shadow)`}>
            <rect
              x="270"
              y="77"
              width="100"
              height="48"
              rx="9"
              fill={`url(#${id}-metal)`}
              stroke="#8596ae"
            />
            <path d="M299 125h42l-5 12h-32Z" fill="#526782" />
            <rect
              x="306"
              y="131"
              width="28"
              height="12"
              rx="4"
              fill="#34445c"
            />
            <rect
              x="273"
              y="262"
              width="94"
              height="90"
              rx="12"
              fill="#34445c"
            />
            <rect
              x="278"
              y="267"
              width="84"
              height="80"
              rx="8"
              fill={`url(#${id}-glass)`}
            />
          </g>
          <text x="390" y="105" className="setup-art-label">
            {t('Camera')}
          </text>
          <text
            x="49"
            y="110"
            className="setup-art-small"
            style={{ fill: 'var(--rv-error)' }}
          >
            {t('Forbidden side')}
          </text>
          <path
            d="M44 179H596"
            stroke="#c5737c"
            strokeWidth="2"
            strokeDasharray="8 6"
          />
          {[
            { x: 166, label: 'A' },
            { x: 486, label: 'B' },
          ].map(({ x, label }) => (
            <g key={label}>
              <circle
                cx={x}
                cy="179"
                r="7"
                fill="#c5737c"
                stroke="white"
                strokeWidth="3"
              />
              <text
                x={x}
                y="202"
                textAnchor="middle"
                className="setup-art-small"
              >
                {label}
              </text>
            </g>
          ))}
          <circle
            cx="320"
            cy="309"
            r="7"
            fill="#4778e8"
            stroke="white"
            strokeWidth="3"
          />
          <path d="M331 309H387" className="setup-art-ext" />
          <text x="395" y="314" className="setup-art-label">
            {t('Reference Position')}
          </text>
          <text x="352" y="167" className="setup-art-small">
            {t('Camera-side Boundary')}
          </text>
          <text
            x="49"
            y="347"
            className="setup-art-small"
            style={{ fill: 'var(--rv-success)' }}
          >
            {t('Allowed side')}
          </text>
          <text x="320" y="391" textAnchor="middle" className="setup-art-small">
            {t('Keep the whole arm clear')}
          </text>
        </>
      ) : (
        <>
          <path d="M44 337H596" stroke="#d5deeb" strokeWidth="2" />
          <g filter={`url(#${id}-shadow)`}>
            <rect
              x="57"
              y="310"
              width="100"
              height="25"
              rx="7"
              fill={`url(#${id}-metal)`}
              stroke="#8596ae"
            />
            <path
              d="M82 310V221L164 122H331V150H179L111 232V310Z"
              fill={`url(#${id}-metal)`}
              stroke="#8596ae"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <circle cx="98" cy="226" r="22" fill="#526782" />
            <circle cx="98" cy="226" r="10" fill="#b6c2d3" />
            <circle cx="170" cy="138" r="22" fill="#526782" />
            <circle cx="170" cy="138" r="10" fill="#b6c2d3" />
            <rect
              x="313"
              y="128"
              width="34"
              height="36"
              rx="5"
              fill="#6d7f98"
            />
            <path d="M320 164h20l-4 16h-12Z" fill="#42556f" />
            <rect
              x="327"
              y="180"
              width="6"
              height="47"
              rx="2"
              fill={`url(#${id}-metal)`}
              stroke="#8797ae"
            />
            <path d="M327 227h6l-3 9Z" fill="#40536e" />
            <rect
              x="247"
              y="319"
              width="166"
              height="14"
              rx="6"
              fill="#34445c"
            />
            <rect
              x="252"
              y="315"
              width="156"
              height="9"
              rx="4"
              fill={`url(#${id}-glass)`}
              stroke="#8797ae"
            />
          </g>
          <path
            d="M210 236H589"
            className="setup-art-dim"
            strokeDasharray="8 6"
          />
          <circle
            cx="330"
            cy="236"
            r="6"
            fill="#4778e8"
            stroke="white"
            strokeWidth="2"
          />
          <path
            d="M380 215H545"
            className="setup-art-dim"
            markerStart={`url(#${id}-arrow)`}
            markerEnd={`url(#${id}-arrow)`}
          />
          <text x="376" y="190" className="setup-art-label setup-art-blue">
            {t('Minimum Travel Height')}
          </text>
          <path
            d="M330 246V309"
            stroke="#10aa95"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
          <path
            d="M420 244V308"
            className="setup-art-dim"
            markerStart={`url(#${id}-arrow)`}
            markerEnd={`url(#${id}-arrow)`}
          />
          <text x="440" y="282" className="setup-art-label">
            2–5 cm
          </text>
          <text x="330" y="371" textAnchor="middle" className="setup-art-label">
            {t('Screen')}
          </text>
        </>
      )}
    </svg>
  );
}
