// Setup illustrations migrated from midscene-private/apps/robot-vision.
import { useId } from 'react';
import {
  type Language,
  t as translate,
  useCalibrationLanguage,
} from '../../i18n';
type Step = 'connection' | 'tool' | 'screen' | 'camera';
function Drawing({
  id,
  step,
  t,
}: {
  id: string;
  step: Step;
  t: (key: string) => string;
}) {
  switch (step) {
    case 'connection':
      return (
        <>
          <rect
            width="640"
            height="400"
            rx="20"
            fill="var(--midscene-surface-muted)"
          />
          <text x="32" y="38" className="setup-art-title">
            {t('Connect Directly to the Controller')}
          </text>
          <text x="32" y="61" className="setup-art-small">
            {t('Connecting does not enable or move the robot.')}
          </text>
          <path d="M229 213H376" className="setup-art-line" />
          <g filter={`url(#${id}-shadow)`}>
            <rect
              x="61"
              y="128"
              width="168"
              height="105"
              rx="10"
              fill="#34445c"
            />
            <rect
              x="69"
              y="136"
              width="152"
              height="89"
              rx="5"
              fill={`url(#${id}-glass)`}
            />
            <path d="M49 233H241L251 249H39Z" fill={`url(#${id}-metal)`} />
            <rect
              x="376"
              y="169"
              width="174"
              height="81"
              rx="10"
              fill={`url(#${id}-metal)`}
              stroke="#8d9db3"
            />
          </g>
          <rect x="389" y="199" width="17" height="13" rx="2" fill="#435873" />
          <circle cx="392" cy="233" r="3" fill="#10aa95" />
          <text x="107" y="283" className="setup-art-label">
            {t('This Computer')}
          </text>
          <text x="418" y="283" className="setup-art-label">
            {t('Controller')}
          </text>
          <text x="271" y="199" className="setup-art-small">
            {t('Ethernet')}
          </text>
          <path d="M500 169V130H479" className="setup-art-line" />
          <g stroke="#7b8ba4" strokeWidth="2">
            <rect
              x="406"
              y="111"
              width="40"
              height="29"
              rx="5"
              fill={`url(#${id}-metal)`}
            />
            <path d="M426 111V85h53v45" fill="none" strokeWidth="12" />
            <circle cx="426" cy="85" r="9" fill="#52647f" />
            <circle cx="479" cy="85" r="9" fill="#52647f" />
          </g>
          <text x="396" y="163" className="setup-art-small">
            {t('Robot Arm')}
          </text>
          <rect
            x="76"
            y="314"
            width="488"
            height="46"
            rx="10"
            fill="var(--diagram-blue-wash)"
          />
          <text x="97" y="343">
            {t('Configure in the terminal → Connect in the browser')}
          </text>
        </>
      );
    case 'tool':
      return (
        <>
          <rect
            width="640"
            height="400"
            rx="20"
            fill="var(--midscene-surface-muted)"
          />
          <text x="32" y="38" className="setup-art-title">
            {t('Measure Origin to Tip')}
          </text>
          <text x="32" y="61" className="setup-art-small">
            {t('Include the holder and adapters. Downward mounting shown.')}
          </text>
          <g filter={`url(#${id}-shadow)`}>
            <path
              d="M232 83h146v30H232Z"
              fill={`url(#${id}-metal)`}
              stroke="#8596ae"
            />
            <ellipse
              cx="305"
              cy="112"
              rx="73"
              ry="17"
              fill="#d0d9e6"
              stroke="#8596ae"
            />
            <rect
              x="284"
              y="113"
              width="42"
              height="88"
              rx="5"
              fill="#6d7f98"
            />
            <path d="M284 185h42l-10 24h-22Z" fill="#42556f" />
            <rect
              x="299"
              y="209"
              width="12"
              height="106"
              rx="4"
              fill={`url(#${id}-metal)`}
              stroke="#8797ae"
            />
            <path d="M299 310h12l-6 23Z" fill="#40536e" />
          </g>
          <circle
            cx="305"
            cy="112"
            r="5"
            fill="#4778e8"
            stroke="white"
            strokeWidth="2"
          />
          <circle
            cx="305"
            cy="333"
            r="5"
            fill="#4778e8"
            stroke="white"
            strokeWidth="2"
          />
          <path d="M305 112H418M305 333H418" className="setup-art-ext" />
          <path
            d="M409 117V328"
            className="setup-art-dim"
            markerStart={`url(#${id}-arrow)`}
            markerEnd={`url(#${id}-arrow)`}
          />
          <rect
            x="386"
            y="197"
            width="111"
            height="49"
            rx="8"
            fill="var(--midscene-surface-muted)"
          />
          <text x="400" y="218" className="setup-art-label setup-art-blue">
            {t('Stylus Length')}
          </text>
          <text x="400" y="236" className="setup-art-small">
            {t('Measured \u00b7 mm')}
          </text>
          <path d="M300 112H186" className="setup-art-ext" />
          <text x="52" y="108" className="setup-art-label">
            {t('Flange Origin')}
          </text>
          <text x="65" y="128" className="setup-art-small">
            {t('Measure from here')}
          </text>
          <path d="M282 157H186" className="setup-art-ext" />
          <text x="100" y="163">
            {t('Holder / Adapter')}
          </text>
          <path d="M299 277H186" className="setup-art-ext" />
          <text x="126" y="282">
            {t('Stylus')}
          </text>
          <text x="258" y="366" className="setup-art-label">
            {t('Contact Tip')}
          </text>
        </>
      );
    case 'screen':
      return (
        <>
          <rect
            width="640"
            height="400"
            rx="20"
            fill="var(--midscene-surface-muted)"
          />
          <text x="32" y="38" className="setup-art-title">
            {t('Connect Phone')}
          </text>
          <text x="32" y="61" className="setup-art-small">
            {t('Scan the QR code to open the calibration page.')}
          </text>
          <rect
            x="65"
            y="132"
            width="210"
            height="150"
            rx="10"
            fill="var(--midscene-surface)"
            stroke="var(--rv-border)"
          />
          <path d="M53 282H287L300 295H40Z" fill={`url(#${id}-metal)`} />
          <g fill="var(--rv-text)">
            {[0, 1, 2].map((i) => (
              <g
                key={i}
                transform={`translate(${i === 1 ? 174 : 128} ${i === 2 ? 206 : 160})`}
              >
                <rect width="28" height="28" />
                <rect
                  x="5"
                  y="5"
                  width="18"
                  height="18"
                  fill="var(--midscene-surface)"
                />
                <rect x="9" y="9" width="10" height="10" />
              </g>
            ))}
            <path d="M174 206H184V216H198V234H188V226H174Z" />
          </g>
          <path
            d="M304 210H379"
            className="setup-art-dim"
            markerEnd={`url(#${id}-arrow)`}
          />
          <rect
            x="414"
            y="102"
            width="130"
            height="234"
            rx="20"
            fill={`url(#${id}-metal)`}
            stroke="var(--rv-border)"
          />
          <rect
            x="422"
            y="110"
            width="114"
            height="218"
            rx="14"
            fill="var(--midscene-surface)"
          />
          <rect
            x="462"
            y="117"
            width="34"
            height="8"
            rx="4"
            fill="var(--rv-text)"
          />
          {[
            [434, 148],
            [514, 148],
            [434, 292],
            [514, 292],
          ].map(([x, y]) => (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width="12"
              height="12"
              fill="var(--rv-text)"
            />
          ))}
          <path
            d="M450 188H510L450 270H510"
            fill="none"
            stroke="var(--rv-accent)"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <text x="320" y="374" textAnchor="middle" className="setup-art-label">
            {t('Same local network · Keep the page open')}
          </text>
        </>
      );
    case 'camera':
      return (
        <>
          <rect
            width="640"
            height="400"
            rx="20"
            fill="var(--midscene-surface-muted)"
          />
          <text x="32" y="38" className="setup-art-title">
            {t('Match Corners and Orientation')}
          </text>
          <text x="32" y="61" className="setup-art-small">
            {t('Fix the camera, select the touch area and check the result.')}
          </text>
          <path
            d="M161 132L72 309H251L184 132"
            fill="var(--diagram-blue-wash)"
          />
          <rect
            x="133"
            y="87"
            width="81"
            height="50"
            rx="10"
            fill={`url(#${id}-metal)`}
            stroke="#8d9db3"
          />
          <circle cx="173" cy="112" r="15" fill="#435873" />
          <circle cx="173" cy="112" r="7" fill="#799bcd" />
          <path d="M82 232L228 243L241 312L72 295Z" fill="#34445c" />
          <path
            d="M86 237L224 248L235 306L78 291Z"
            fill={`url(#${id}-glass)`}
            stroke="#4778e8"
            strokeWidth="2"
          />
          <path
            d="M279 238H338"
            className="setup-art-line"
            markerEnd={`url(#${id}-arrow)`}
          />
          <text x="283" y="218" className="setup-art-small">
            {t('Correct')}
          </text>
          <rect
            x="385"
            y="127"
            width="156"
            height="195"
            rx="12"
            fill="#34445c"
          />
          <rect
            x="391"
            y="133"
            width="144"
            height="183"
            rx="7"
            fill={`url(#${id}-glass)`}
            stroke="#10aa95"
            strokeWidth="2"
          />
          <g fill="#10aa95" stroke="white" strokeWidth="2">
            <circle cx="86" cy="237" r="5" />
            <circle cx="224" cy="248" r="5" />
            <circle cx="235" cy="306" r="5" />
            <circle cx="78" cy="291" r="5" />
            <circle cx="391" cy="133" r="5" />
            <circle cx="535" cy="133" r="5" />
            <circle cx="535" cy="316" r="5" />
            <circle cx="391" cy="316" r="5" />
          </g>
          <path
            d="M400 151h42m-42 0v42"
            className="setup-art-line"
            markerEnd={`url(#${id}-arrow)`}
          />
          <path
            d="M400 151h42"
            className="setup-art-line"
            markerEnd={`url(#${id}-arrow)`}
          />
          <text x="453" y="157" className="setup-art-small setup-art-on-glass">
            {t('Right')}
          </text>
          <text x="399" y="212" className="setup-art-small setup-art-on-glass">
            {t('Down')}
          </text>
          <text x="411" y="108" className="setup-art-label">
            {t('Corrected')}
          </text>
          <text x="67" y="354" className="setup-art-small">
            {t('Keep the full touch area in view.')}
          </text>
          <text x="386" y="354" className="setup-art-small">
            {t('Match top-left, right and down.')}
          </text>
        </>
      );
  }
}

/** Editable instructional art; all labels use the UI locale, not baked-in text. */
export function SetupIllustration({
  step,
  language,
}: {
  step: Step;
  language?: Language;
}) {
  const preference = useCalibrationLanguage((state) => state.language);
  const t = (key: string) => translate(key, [], language ?? preference);
  const id = useId().replace(/:/g, '');
  return (
    <svg
      className="robot-setup-illustration"
      viewBox="0 0 640 400"
      role="img"
      aria-label={t('Setup illustration')}
      focusable={false}
    >
      <title>{t('Setup illustration')}</title>
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
      <Drawing id={id} step={step} t={t} />
    </svg>
  );
}
