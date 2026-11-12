import type { RobotFault } from '@midscene/arm-kit/adapter-development';
import {
  MG400_CONTROLLER_ALARMS,
  MG400_SERVO_ALARMS,
} from './mg400-alarm-catalog.js';

/**
 * Look up the controller's own alarm text. Group 0 is the controller catalog,
 * later groups are the servo catalog; a code the catalog does not cover keeps
 * the generated English message rather than showing an empty description.
 */
function catalogText(group: number, code: number) {
  const table = group === 0 ? MG400_CONTROLLER_ALARMS : MG400_SERVO_ALARMS;
  const entry = table[code];
  if (!entry) return undefined;
  return {
    description: { en: entry.en, zh: entry.zh },
    ...(Number.isFinite(entry.level) ? { level: entry.level } : {}),
    ...(entry.enSolution || entry.zhSolution
      ? {
          solution: {
            en: entry.enSolution || entry.zhSolution || '',
            zh: entry.zhSolution || entry.enSolution || '',
          },
        }
      : {}),
  };
}

/** Preserve group provenance; the same numeric code can mean different things. */
export function mg400Faults(
  groups: readonly (readonly number[])[],
  mode?: number,
): RobotFault[] {
  const faults: RobotFault[] = [];
  // A flat `GetErrorID()` reply can repeat one code, and so can a nested reply
  // when the same alarm is reported twice. One alarm, one card: the operator
  // otherwise sees a duplicate that looks like two independent faults.
  const seen = new Set<string>();
  groups.forEach((codes, group) => {
    for (const code of codes) {
      if (code === 0) continue;
      const identity = `${group}:${code}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      const limit = group === 0 && code >= 64 && code <= 71;
      // MG400 uses 72/73 for its parallelogram linkage. The shared Studio
      // installer catalog labels these J5, so it must not supply an axis here.
      const linkageLimit = group === 0 && (code === 72 || code === 73);
      const axis = limit ? Math.floor((code - 64) / 2) + 1 : group || undefined;
      const direction =
        limit || linkageLimit
          ? code % 2 === 0
            ? 'positive'
            : 'negative'
          : undefined;
      const catalog = catalogText(group, code);
      faults.push({
        code: String(code),
        message: limit
          ? `MG400 joint ${axis} ${direction} limit reached; the limit condition must be resolved before clearing.`
          : linkageLimit
            ? `MG400 parallelogram ${direction} limit alarm; consult the controller-specific recovery procedure.`
            : (catalog?.description.en ??
              `MG400 ${group === 0 ? 'controller' : `J${group} servo`} fault ${code}`),
        ...catalog,
        ...(axis
          ? { affected: { joint: axis } }
          : linkageLimit
            ? { affected: { mechanism: 'parallelogram' } }
            : {}),
        ...(direction ? { limitDirection: direction } : {}),
        ...(linkageLimit
          ? {
              description: {
                en: `Parallelogram ${direction} limit alarm.`,
                zh: `平行四边形机构${direction === 'positive' ? '正' : '负'}限位告警。`,
              },
              solution: {
                en: 'Check the controller recovery instructions for the linkage.',
                zh: '请按控制器的连杆机构恢复说明处理。',
              },
            }
          : {}),
        // Unknown codes and persistent limits are not proven remotely recoverable.
        recoverable: false,
        category: group === 0 ? 'controller' : 'motion',
        severity: 'error',
        vendorCode: code,
        raw: {
          group,
          axis,
          code,
          ...(catalog
            ? { catalogSource: 'MG400 controller alarm_controller.json' }
            : {}),
          ...(linkageLimit
            ? {
                kind: 'linkage-limit',
                mechanism: 'parallelogram',
                direction,
                catalogSource:
                  'MG400 controller catalog sample (SHA-256 6386e6d9f607ef7f836172bae0a60296d537806e255d813f7b6903bda61d32cd); installed firmware catalog unverified',
              }
            : {}),
          ...(limit
            ? {
                kind: 'joint-limit',
                direction,
                catalogSource:
                  'DobotStudio Pro 2.8.5 bundled controller catalog; controller version unverified',
              }
            : {}),
        },
      });
    }
  });
  if (mode === 9 && faults.length === 0)
    faults.push({
      code: '-9',
      message: 'MG400 reports error mode without an alarm code',
      recoverable: false,
      category: 'controller',
      severity: 'error',
      raw: { mode, synthetic: true },
    });
  return faults;
}
