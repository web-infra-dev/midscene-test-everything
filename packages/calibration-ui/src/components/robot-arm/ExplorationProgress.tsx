import { Progress, Tag, Typography } from 'antd';
import { t } from '../../i18n';
import type { AssistedCalibrationState } from '../../robot-arm-api';

const operations = {
  travel: 'Moving above the next point',
  search: 'Finding screen contact',
  release: 'Lifting to confirm release',
  refine: 'Measuring contact height',
  press: 'Confirming stable contact',
  slide: 'Sliding to the next point',
  recover: 'Touch lost: recovering this endpoint',
};
/** Keep the endpoint and evidence visible after an interrupted run. */
export function ExplorationProgress({
  session,
}: { session: AssistedCalibrationState }) {
  const {
    capture,
    points = [],
    samples = 0,
    automaticPhase,
    explorationMode = 'standard',
  } = session;
  const failed =
    (session.stage === 'interrupted' && session.collectionFailed) ||
    session.stage === 'capture-failed';
  if (
    !capture ||
    (!failed && session.stage !== 'collecting' && session.stage !== 'reprobing')
  )
    return null;
  const local = automaticPhase === 'local';
  const total = explorationMode === 'standard' ? 9 : 6;
  const layout = session.mapping?.layout ?? session.layout;
  const grid = points.filter((point) => point.purpose !== 'direction');
  const measured = points
    .filter((point) => point.purpose === 'direction')
    .flatMap((point) =>
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
  return (
    <section
      className="robot-exploration-progress"
      aria-label={t('Exploration progress')}
    >
      <div className="robot-web-actions">
        <Tag>
          {t(
            explorationMode === 'slide'
              ? 'Fast'
              : explorationMode === 'fast'
                ? 'Fast probing'
                : 'Regular',
          )}
        </Tag>
        <Typography.Text strong>
          {t(local ? 'Direction probe {0} / {1}' : 'Grid point {0} / {1}', [
            capture.index,
            capture.total,
          ])}
        </Typography.Text>
        <Tag color={failed ? 'error' : 'processing'}>
          {t(
            failed
              ? 'Stopped at this point'
              : capture.heightRecheck
                ? 'Repeating validation heights'
                : 'Collecting',
          )}
        </Tag>
      </div>
      <Typography.Paragraph aria-live="polite">
        {capture.operation &&
          (failed
            ? capture.operation === 'recover'
              ? t('Touch recovery did not succeed')
              : t('Stopped during: {0}', [t(operations[capture.operation])])
            : t(
                search?.precision
                  ? 'Measuring this point within the safe range'
                  : operations[capture.operation],
              ))}
        {' · '}
        {t('{0} / {1} points recorded', [samples, total])}
      </Typography.Paragraph>
      <Progress
        percent={Math.round(Math.min(points.length / (3 + total), 1) * 100)}
        status={failed ? 'exception' : 'active'}
      />
      {explorationMode !== 'standard' && (
        <Typography.Paragraph type="secondary">
          {t(
            'This mode assumes a horizontal screen and a compliant tip. Secure the phone on a rigid support; do not hold it by hand during motion.',
          )}
        </Typography.Paragraph>
      )}
      {!local && layout && (
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
            {capture.targets && (
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
                  r="13"
                  fill="white"
                  stroke="#94a3b8"
                />
                <text
                  x={point.x}
                  y={point.y + 5}
                  textAnchor="middle"
                  fill="#64748b"
                  fontSize="14"
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
                r="6"
                fill="#21866a"
              />
            ))}
            <circle
              cx={capture.target.point.x}
              cy={capture.target.point.y}
              r="19"
              fill="none"
              stroke={failed ? '#cf1322' : '#1677ff'}
              strokeWidth="3"
            />
          </svg>
          <Typography.Text type="secondary">
            {t(
              'Numbered circles: planned points · Green dots: measured contacts · Ring: current target',
            )}
          </Typography.Text>
        </div>
      )}
      {(search || heightRange !== undefined) && (
        <details className="robot-exploration-diagnostics">
          <summary>{t('Height diagnostics')}</summary>
          {heightRange !== undefined && (
            <p>
              {t(
                'Direction-probe height range: {0} mm. This alone does not identify tilt or movement.',
                [heightRange.toFixed(2)],
              )}
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
