import { Tag, Typography } from 'antd';
import { useState } from 'react';
import { t } from '../../i18n';
import type {
  RobotFault,
  RobotKinematics,
  RuntimeState,
} from '../../robot-arm-api';
import './JointGuide.less';

type JointSample = NonNullable<
  NonNullable<RuntimeState['state']['status']>['joints']
>;
export function JointGuide({
  kinematics,
  sample,
  faults,
  stale,
}: {
  kinematics: RobotKinematics;
  sample?: JointSample;
  faults: RobotFault[];
  stale: boolean;
}) {
  const [chosen, choose] = useState<number>();
  const { joints, schematic } = kinematics;
  const jointFaults = (index: number) =>
    faults.filter(
      (f) =>
        f.affected && 'joint' in f.affected && f.affected.joint === index + 1,
    );
  const faultIndex = joints.findIndex((_, i) => jointFaults(i).length > 0);
  const selected = chosen ?? (faultIndex < 0 ? 0 : faultIndex);
  const fresh =
    !stale &&
    sample &&
    !sample.stale &&
    Date.now() - Date.parse(sample.receivedAt) <= 2500;
  return (
    <section className="joint-guide">
      <div className="joint-guide-heading">
        <Typography.Title level={5}>
          {t('Joint Recovery Guide')}
        </Typography.Title>
        <Tag color={fresh ? 'green' : 'default'}>
          {t(fresh ? 'Live joint readings' : 'Readings unavailable or stale')}
        </Tag>
      </div>
      {schematic && (
        <svg
          viewBox={`0 0 ${schematic.width} ${schematic.height}`}
          role="img"
          aria-label={t('Joint Recovery Guide')}
        >
          <title>{t('Joint Recovery Guide')}</title>
          <image
            href={schematic.image}
            width={schematic.width}
            height={schematic.height}
          />
          {schematic.markers.slice(0, joints.length).map(({ x, y }, i) => (
            <g
              key={i}
              className={`joint-guide-node ${i === selected ? 'is-selected' : ''} ${jointFaults(i).length ? 'is-faulted' : ''}`}
              onClick={() => choose(i)}
            >
              <circle cx={x} cy={y} r={17} />
              <text x={x} y={y + 5} textAnchor="middle">
                J{i + 1}
              </text>
            </g>
          ))}
        </svg>
      )}
      <div className="joint-guide-values">
        {joints.map((joint, i) => {
          const unit = joint.unit === 'degrees' ? '°' : ' mm';
          const value = sample?.values[i];
          const alarms = jointFaults(i);
          return (
            <button
              type="button"
              key={i}
              className={`joint-guide-value ${alarms.length ? 'is-faulted' : ''}`}
              aria-pressed={i === selected}
              onClick={() => choose(i)}
            >
              <span>
                <strong>J{i + 1}</strong>
                {joint.name !== `J${i + 1}` && ` · ${joint.name}`}
              </span>
              <strong className="joint-guide-angle">
                {fresh && typeof value === 'number' && Number.isFinite(value)
                  ? value.toFixed(2) + unit
                  : '—'}
              </strong>
              {joint.limits && (
                <span className="joint-guide-reference">
                  {joint.limits.min}
                  {unit} ～ {joint.limits.max}
                  {unit}
                </span>
              )}
              {alarms.map((f, index) => (
                <span key={`${f.code}-${index}`}>
                  {f.code} ·{' '}
                  {f.limitDirection === 'positive'
                    ? t('Positive limit')
                    : f.limitDirection === 'negative'
                      ? t('Negative limit')
                      : t('Joint fault')}
                </span>
              ))}
            </button>
          );
        })}
      </div>
    </section>
  );
}
