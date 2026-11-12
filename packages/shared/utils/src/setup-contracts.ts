import type {
  EffectiveCapabilities,
  MotionAcceleration,
  MotionSpeed,
  ScreenProfile,
} from './contracts.js';

export const ROBOT_SETUP_REFERENCE = {
  pressDepthMm: 0.5,
  safeHeightMm: 5,
  baseRatio: 0.8,
} as const;

export function supportsFlangeContact(
  capabilities?: Pick<EffectiveCapabilities, 'orientation' | 'setupDefaults'>,
): boolean {
  return (
    capabilities?.orientation === 'yaw' &&
    capabilities.setupDefaults?.verticalFlangeContact === true
  );
}

export interface RobotSetupDefaults {
  verticalFlangeContact?: boolean;
  actionSpeed: MotionSpeed;
  actionAcceleration: MotionAcceleration;
  /**
   * Motion timing only. Tool offsets, screen dimensions and camera mapping are
   * measured per installation and are never derived from another setup.
   */
  motion?: Pick<
    ScreenProfile,
    | 'pressDepthMm'
    | 'safeHeightMm'
    | 'contactMs'
    | 'swipeEndpointHoldMs'
    | 'longPressMs'
    | 'dragHoldMs'
    | 'releaseSpeedFactor'
    | 'releaseAccelerationFactor'
    | 'successorStartLeadMs'
    | 'motionTimeoutMs'
  >;
}

export function robotSetupDefaults(
  adapterId: string,
): RobotSetupDefaults | undefined {
  if (['mg400', 'dobot-mg400'].includes(adapterId)) {
    // Motion parameters from the current bench setup. They describe how the
    // arm moves and touches, not what it is installed with.
    return {
      verticalFlangeContact: true,
      actionSpeed: { kind: 'ratio', value: 1 },
      actionAcceleration: { kind: 'ratio', value: 1 },
      motion: {
        pressDepthMm: 0.5,
        safeHeightMm: 5,
        contactMs: 30,
        swipeEndpointHoldMs: 30,
        longPressMs: 500,
        dragHoldMs: 80,
        releaseSpeedFactor: 0.4,
        releaseAccelerationFactor: 0.4,
        successorStartLeadMs: 0,
        motionTimeoutMs: 60000,
      },
    };
  }
}

export interface RobotConnectionField {
  key: string;
  label: string;
  type: 'text' | 'number';
  required?: boolean;
  advanced?: boolean;
  defaultValue?: string | number;
  min?: number;
  max?: number;
}

export interface RobotAdapterSetup {
  id: string;
  name: string;
  fields: RobotConnectionField[];
  defaults?: RobotSetupDefaults;
}

export interface RobotConnectionSettings {
  adapter: string;
  options: Record<string, string | number>;
}

export interface RobotSetupStatus {
  runtimeAvailable?: boolean;
  managed: boolean;
  phase: 'unconfigured' | 'connecting' | 'connected' | 'error';
  /** Changes on every runtime replacement, including reconnects after failure. */
  session: string;
  /** Absolute data folder on the computer running the Robot Arm service. */
  storageRoot?: string;
  installationId?: string;
  connection?: RobotConnectionSettings;
  error?: string;
}

/**
 * Controller remote-control modes. `tp` hands the command channel to the teach
 * pendant or DobotStudio, `tcp` hands it to this project, and `io` / `modbus`
 * hand it to fieldbus inputs. Only the MG400 adapter reports and switches this
 * setting today.
 */
export type RobotRemoteControlMode = 'tp' | 'io' | 'modbus' | 'tcp';

export interface RobotRemoteModeStatus {
  supported: boolean;
  adapter?: string;
  /** Controller HTTP connection state; `unreachable` when it did not answer. */
  connectionState?: string;
  /**
   * Mode inferred from the command channel rather than from the stored setting:
   * `tcp` means the dashboard answers (TCP/IP 二次开发), `tp` means something
   * else owns the arm. Fieldbus modes are reported as `tp` because this product
   * does not offer them.
   */
  mode?: RobotRemoteControlMode;
  error?: string;
}

export interface RobotConnectionRequest extends RobotConnectionSettings {
  session: string;
  replace?: boolean;
  installationId?: string;
  newInstallation?: boolean;
  /** Optional display name for a newly created installation. */
  installationName?: string;
  installationUnchanged?: boolean;
}

export interface RobotInstallationSummary extends RobotConnectionSettings {
  archived?: boolean;
  installationId: string;
  name: string;
  /** Controller address when the adapter has one. */
  endpoint?: string;
  /** Another saved installation uses the same adapter and controller address. */
  duplicate?: boolean;
  lastUsedAt: string;
  hasConfiguration: boolean;
  calibrationStatus: 'accepted' | 'pending' | 'invalid' | 'missing';
  toolName?: string;
  screenName?: string;
  error?: string;
}

/** Match saved endpoints, including adapter defaults omitted by older selections. */
export function robotConnectionKey(
  connection: RobotConnectionSettings,
  fields: readonly RobotConnectionField[] = [],
): string {
  const values: Record<string, string | number> = Object.fromEntries(
    fields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue!]),
  );
  Object.assign(values, connection.options);
  if (typeof values.host === 'string')
    values.host = values.host.trim().toLowerCase();
  return JSON.stringify([
    connection.adapter,
    Object.entries(values).sort(([a], [b]) => a.localeCompare(b)),
  ]);
}

export interface RobotSetupResetRequest {
  session: string;
  confirm: true;
}
