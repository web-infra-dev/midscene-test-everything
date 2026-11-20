import {
  type CartesianPose,
  type RobotActionAuditRecord,
  semanticJson,
} from '../../contracts.js';
import { assertPose, quaternionDistance } from '../../domain.js';

export interface ParkingRecheck {
  pose: CartesianPose;
  source: 'audit' | 'saved';
  checkedAt?: string;
  actionId?: string;
}

export function recentVerifiedParking(
  records: readonly RobotActionAuditRecord[],
  contextVersion: string,
  calibrationIds: readonly string[],
  orientation: CartesianPose['orientation'],
  orientationToleranceRad: number,
  allowOtherYaw = false,
): ParkingRecheck | undefined {
  if (!calibrationIds.length) return;
  const plans = new Map(
    records
      .filter(({ detail }) => detail?.stage === 'shared-parking-candidates')
      .map((record) => [record.id, record.detail]),
  );
  const visible = new Set(
    records.flatMap((record) => {
      const evidence = record.detail?.evidence as
        | { clear?: boolean; screens?: { clear?: boolean }[] }
        | undefined;
      return record.detail?.stage === 'shared-parking-visibility' &&
        record.outcome === 'completed' &&
        evidence?.clear === true &&
        Array.isArray(evidence.screens) &&
        evidence.screens.length === calibrationIds.length &&
        evidence.screens.every((screen) => screen?.clear === true) &&
        record.detail.pose
        ? [semanticJson([record.id, record.detail.pose])]
        : [];
    }),
  );
  let otherYaw: ParkingRecheck | undefined;
  for (const record of records) {
    const { detail } = record;
    if (
      detail?.stage !== 'shared-parking-candidate' ||
      detail.result !== 'selected' ||
      record.outcome !== 'completed' ||
      !visible.has(semanticJson([record.id, detail.measured]))
    )
      continue;
    const plan = plans.get(record.id);
    if (
      !plan ||
      (plan.contextVersion && plan.contextVersion !== contextVersion)
    )
      continue;
    const references = plan.references as
      | { calibrationId?: string }[]
      | undefined;
    if (
      !Array.isArray(references) ||
      references.length !== calibrationIds.length ||
      !calibrationIds.every((id) =>
        references.some((reference) => reference?.calibrationId === id),
      )
    )
      continue;
    const pose = detail.measured as CartesianPose;
    try {
      assertPose(pose);
    } catch {
      continue;
    }
    const recheck: ParkingRecheck = {
      pose,
      source: 'audit',
      checkedAt: record.at,
      actionId: record.id,
    };
    if (
      quaternionDistance(pose.orientation, orientation) <=
      orientationToleranceRad
    )
      return recheck;
    if (allowOtherYaw && pose.orientation.x === 0 && pose.orientation.y === 0)
      otherYaw ??= recheck;
  }
  return otherYaw;
}
