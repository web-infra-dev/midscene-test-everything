import { Progress, Tag, Typography } from 'antd';
import { t } from '../../i18n';
import type { AssistedCalibrationState } from '../../robot-arm-api';

const operations = {
  travel: 'Moving above the next point',
  search: 'Finding screen contact',
  release: 'Lifting to confirm release',
  refine: 'Measuring contact height',
  press: 'Confirming stable contact',
  slide: 'Sliding and checking touch at the endpoint',
  recover: 'Touch lost. Lifting and retrying from inside the screen',
};
/** Keep the endpoint and evidence visible after an interrupted run. */
export function ExplorationProgress({
  session,
}: { session: AssistedCalibrationState }) {
  const { capture, points = [], samples = 0, automaticPhase } = session;
  const failed =
    (session.stage === 'interrupted' && session.collectionFailed) ||
    session.stage === 'capture-failed';
  if (session.calibration?.auto?.checkingVisibility)
    return <output>{t('Checking screen visibility')}</output>;
  if (session.stage === 'collecting' && session.recheckingPayload)
    return <output>{t('Reconfirming the tool payload…')}</output>;
  if (session.stage === 'collecting' && session.referenceTravel)
    return (
      <output>
        {t(
          session.referenceTravel === 'approach'
            ? 'Preparing to move to the calibration reference. Keep the path clear.'
            : 'Preparing to lift and return to the reference. Keep the path clear.',
        )}
      </output>
    );
  if (session.stage === 'returning')
    return <output>{t('Preparing boundary verification')}</output>;
  if (session.stage === 'avoiding-camera')
    return <output>{t('Avoiding camera')}</output>;
  if (session.stage === 'safety') {
    const boundary = session.calibration?.progress;
    return (
      <output>
        {boundary
          ? t(
              boundary.group === 'hover'
                ? 'Hover boundary check {0} / {1}'
                : 'Contact boundary check {0} / {1}',
              [boundary.index, boundary.total],
            )
          : t('Checking screen boundaries')}
      </output>
    );
  }
  if (
    !capture ||
    (!failed && session.stage !== 'collecting' && session.stage !== 'reprobing')
  )
    return null;
  const local = automaticPhase === 'local';
  const height = automaticPhase === 'height';
  const showMap = !local && !height;
  const total = capture.total;
  const layout = session.mapping?.layout ?? session.layout;
  const markerScale = layout ? Math.min(layout.width, layout.height) / 72 : 1;
  const grid = points.filter((point) => point.purpose !== 'direction');
  const probes = points.filter((point) => point.purpose === 'direction');
  const completed = Math.max(
    0,
    Math.min(
      total,
      local ? probes.length : height ? probes.length - 3 : samples,
    ),
  );
  const measured = probes.flatMap((point) =>
    point.probeStep?.heightIntervalMm
      ? [
          (point.probeStep.heightIntervalMm[0] +
            point.probeStep.heightIntervalMm[1]) /
            2,
        ]
      : [],
  );
  const heightRange =
    measured.length > 1
      ? Math.max(...measured) - Math.min(...measured)
      : undefined;
  const search = capture.heightSearch;
  const title = local
    ? capture.index === 1
      ? 'Finding the reference contact'
      : 'Direction probe {0} / {1}'
    : height
      ? 'Height sweep {0} / {1}'
      : capture.mode === 'slide'
        ? 'Slide sample {0} / {1}'
        : 'Grid point {0} / {1}';
  const operation = capture.operation && operations[capture.operation];
  return (
    <section
      className="robot-exploration-progress"
      aria-label={t('Exploration progress')}
    >
      <div className="robot-exploration-heading">
        <Typography.Text strong>
          {t(title, [capture.index, total])}
        </Typography.Text>
        {failed && <Tag color="error">{t('Stopped at this point')}</Tag>}
      </div>
      <div className="robot-exploration-status" aria-live="polite">
        {failed && capture.operation === 'recover'
          ? t('Touch recovery did not succeed')
          : failed && operation
            ? t('Stopped during: {0}', [t(operation)])
            : t(
                capture.heightRecheck
                  ? 'Repeating validation heights'
                  : height
                    ? 'Short sweeps at different heights establish stable contact'
                    : search?.precision
                      ? 'Measuring this point within the safe range'
                      : (operation ?? 'Waiting for touch observation'),
              )}
      </div>
      <Progress
        percent={total > 0 ? Math.round((completed / total) * 100) : 0}
        showInfo={false}
        aria-label={t('{0} / {1} points recorded', [completed, total])}
        status={failed ? 'exception' : 'active'}
      />
      {showMap && layout && capture.targets && capture.targets.length > 0 && (
        <div className="robot-exploration-map">
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label={t('Recorded contacts and current target')}
          >
            <title>{t('Recorded contacts and current target')}</title>
            <rect
              x="1"
              y="1"
              width={layout.width - 2}
              height={layout.height - 2}
              rx="12"
              fill="#fafafa"
              stroke="#cbd5e1"
            />
            {capture.mode === 'slide' && (
              <polyline
                points={capture.targets.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#94a3b8"
                strokeDasharray="5 6"
                strokeWidth="2"
              />
            )}
            {capture.targets?.map((point, i) => (
              <g key={`${point.x}:${point.y}`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={8 * markerScale}
                  fill="white"
                  stroke="#94a3b8"
                />
                <text
                  x={point.x}
                  y={point.y}
                  dominantBaseline="central"
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize={10 * markerScale}
                >
                  {i + 1}
                </text>
              </g>
            ))}
            {grid.map((point, i) => (
              <circle
                key={`${point.point.x}:${point.point.y}:${i}`}
                cx={point.point.x}
                cy={point.point.y}
                r={3 * markerScale}
                fill="#21866a"
              />
            ))}
            <circle
              cx={capture.target.point.x}
              cy={capture.target.point.y}
              r={10 * markerScale}
              fill="none"
              stroke={failed ? '#cf1322' : '#1677ff'}
              strokeWidth={1.5 * markerScale}
            />
          </svg>
          <Typography.Text type="secondary">
            {t(
              'Numbered points are planned. Green marks recorded touches and the ring marks the current target.',
            )}
          </Typography.Text>
        </div>
      )}
      {(search || heightRange !== undefined) && (
        <details className="robot-exploration-diagnostics">
          <summary>{t('Height diagnostics')}</summary>
          {heightRange !== undefined && (
            <p>
              {t('Measured contact height range: {0} mm', [
                heightRange.toFixed(2),
              ])}
            </p>
          )}
          {search && (
            <>
              <p>
                {t(
                  'Local recovery: {0} / 6 steps · Run total: {1} / 12 steps',
                  [search.localSteps, search.totalSteps],
                )}
              </p>
              <p>
                {t(
                  'Predicted Z {0} mm · Measured Z {1} mm · Lower limit {2} mm',
                  [
                    search.predictedZ.toFixed(2),
                    search.measuredZ?.toFixed(2) ?? '—',
                    search.floorZ.toFixed(2),
                  ],
                )}
              </p>
              <p>
                {t(
                  search.touching === undefined
                    ? 'Waiting for touch observation'
                    : search.touching
                      ? 'Touch confirmed at the last observation'
                      : 'No touch confirmed at the last observation',
                )}
              </p>
            </>
          )}
        </details>
      )}
    </section>
  );
}
