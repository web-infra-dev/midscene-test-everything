import { RobotArmError, SCREEN_TILT_LIMIT_DEGREES } from '../contracts.js';
import { assertPose, assertWorkspace } from '../domain.js';
import type {
  CapabilityDescriptor,
  RobotArmAdapter,
  RobotDriver,
} from './contracts.js';

// Stable identifiers used by the browser to show supported controls.
const driverMethods = {
  'state.controller': ['readControllerState'],
  'control.motion-settings': ['readMotionSettings', 'updateMotionSettings'],
  'state.payload-application': ['readPayloadApplication'],
  'state.cartesian': ['readPose'],
  'state.joints': ['readJoints'],
  'motion.linear': ['moveLinear'],
  'motion.linear-sequence': ['beginLinearSequence'],
  'motion.ptp': ['movePtp'],
  'motion.joints': ['moveJoints'],
  'control.stop': ['stop'],
  'control.enable': ['enable'],
  'control.enable-with-payload': ['enableWithPayload', 'appliedPayload'],
  'control.apply-payload': ['applyPayload'],
  'control.disable': ['disable'],
  'control.clear-faults': ['clearFaults'],
  'control.drag': ['enterDragMode', 'exitDragMode'],
  'control.jog': ['startJog', 'stopJog'],
  'control.pause': ['pause', 'resume'],
  'control.emergency-stop': ['emergencyStop'],
  'kinematics.forward': ['forwardKinematics'],
  'kinematics.inverse': ['inverseKinematics'],
  'kinematics.reachability': ['checkReachability'],
} as const satisfies Record<string, readonly (keyof RobotDriver)[]>;
const motionLimits = {
  'motion.linear': 'linear',
  'motion.linear-sequence': 'linearSequence',
  'motion.ptp': 'ptp',
  'motion.joints': 'joints',
} as const;

export class DriverSupport {
  constructor(readonly adapter: RobotArmAdapter) {
    if (
      !adapter ||
      adapter.contractVersion !== 1 ||
      !adapter.id ||
      !adapter.name ||
      !adapter.connectionIdentity ||
      !adapter.driver
    )
      throw new RobotArmError(
        'INVALID_ADAPTER',
        'Adapter contractVersion 1, identity and Driver are required',
      );
    for (const method of ['connect', 'disconnect', 'getState', 'stop'] as const)
      if (typeof adapter.driver[method] !== 'function')
        throw new RobotArmError('INVALID_ADAPTER', `Missing Driver.${method}`);
    const k = adapter.kinematics;
    if (
      !k ||
      !Number.isInteger(k.jointCount) ||
      k.jointCount < 1 ||
      !Array.isArray(k.joints) ||
      k.joints.length !== k.jointCount ||
      !['fixed', 'yaw', 'full'].includes(k.orientation) ||
      !Array.isArray(k.cartesianDof)
    )
      throw new RobotArmError(
        'INVALID_ADAPTER',
        'Invalid kinematic descriptor',
      );
    if (
      new Set(k.cartesianDof).size !== k.cartesianDof.length ||
      k.cartesianDof.some(
        (d) => !['x', 'y', 'z', 'rx', 'ry', 'rz'].includes(d),
      ) ||
      (k.orientationToleranceRadians !== undefined &&
        (!Number.isFinite(k.orientationToleranceRadians) ||
          k.orientationToleranceRadians < 0)) ||
      (k.screenNormalToleranceDegrees !== undefined &&
        (!Number.isFinite(k.screenNormalToleranceDegrees) ||
          k.screenNormalToleranceDegrees < 0 ||
          k.screenNormalToleranceDegrees > SCREEN_TILT_LIMIT_DEGREES))
    )
      throw new RobotArmError(
        'INVALID_ADAPTER',
        'Invalid Cartesian freedom or tolerances',
      );
    for (const j of k.joints) {
      if (
        !j ||
        !j.name ||
        !['revolute', 'prismatic'].includes(j.type) ||
        j.unit !== (j.type === 'revolute' ? 'degrees' : 'mm') ||
        (j.limits &&
          (!Number.isFinite(j.limits.min) ||
            !Number.isFinite(j.limits.max) ||
            j.limits.min >= j.limits.max ||
            !j.limits.source))
      )
        throw new RobotArmError(
          'INVALID_ADAPTER',
          'Invalid joint type, unit or limits',
        );
    }
    if (k.fixedOrientation)
      assertPose({
        frame: 'base',
        positionMm: { x: 0, y: 0, z: 0 },
        orientation: k.fixedOrientation,
      });
    if (k.orientation !== 'full' && !k.fixedOrientation)
      throw new RobotArmError(
        'INVALID_ADAPTER',
        'Restricted orientation requires a reference quaternion',
      );
    if (k.workspace) assertWorkspace(k.workspace);
    if (
      !adapter.readinessPolicy ||
      !Number.isFinite(adapter.readinessPolicy.maxStateAgeMs) ||
      adapter.readinessPolicy.maxStateAgeMs <= 0 ||
      !Array.isArray(adapter.readinessPolicy.required)
    )
      throw new RobotArmError('INVALID_ADAPTER', 'Invalid readiness policy');
    if (
      adapter.readinessPolicy.required.some(
        (signal) =>
          ![
            'authority',
            'power',
            'operationMode',
            'emergencyStop',
            'protectiveStop',
          ].includes(signal),
      )
    )
      throw new RobotArmError(
        'INVALID_ADAPTER',
        'Unknown required readiness signal',
      );
    const descriptors = this.descriptors;
    for (const d of descriptors) {
      if (
        d.payloadApplication &&
        (d.id !== 'control.enable-with-payload' ||
          typeof d.payloadApplication.requiresDisabled !== 'boolean')
      )
        throw new RobotArmError(
          'INVALID_ADAPTER',
          'Invalid payload application policy',
        );
      if (
        ['state.payload-application', 'control.apply-payload'].includes(d.id) &&
        !descriptors.some(
          (capability) => capability.id === 'control.enable-with-payload',
        )
      )
        throw new RobotArmError(
          'INVALID_ADAPTER',
          'Payload application requires payload enable support',
        );
      if (d.id === 'control.enable-with-payload') {
        const p = d.payload;
        if (
          !p ||
          !Number.isFinite(p.massKg?.min) ||
          !Number.isFinite(p.massKg?.max) ||
          p.massKg.min < 0 ||
          p.massKg.max < p.massKg.min ||
          (p.inertiaKgM2 &&
            (!Number.isFinite(p.inertiaKgM2.min) ||
              p.inertiaKgM2.min < 0 ||
              (p.inertiaKgM2.max !== undefined &&
                (!Number.isFinite(p.inertiaKgM2.max) ||
                  p.inertiaKgM2.max < p.inertiaKgM2.min))))
        )
          throw new RobotArmError(
            'INVALID_ADAPTER',
            'Payload capability requires explicit supported ranges',
          );
      }
      if (
        d.id.startsWith('motion.') &&
        (!d.constraints ||
          !d.constraints.speed ||
          !d.constraints.acceleration ||
          !Object.keys(d.constraints.speed).length)
      )
        throw new RobotArmError(
          'INVALID_ADAPTER',
          `${d.id} requires explicit motion constraints`,
        );
      if (
        d.constraints &&
        (!d.constraints.speed || !d.constraints.acceleration)
      )
        throw new RobotArmError(
          'INVALID_ADAPTER',
          'Missing motion constraint units',
        );
      if (d.constraints)
        for (const ranges of [d.constraints.speed, d.constraints.acceleration])
          for (const [kind, range] of Object.entries<
            { min: number; max: number } | undefined
          >(ranges)) {
            if (
              !['ratio', 'linear', 'angular', 'joints'].includes(kind) ||
              !range ||
              !Number.isFinite(range.min) ||
              !Number.isFinite(range.max) ||
              range.min <= 0 ||
              range.max < range.min ||
              (kind === 'ratio' && range.max > 1)
            )
              throw new RobotArmError(
                'INVALID_ADAPTER',
                `Invalid ${d.id} constraints`,
              );
          }
    }
  }
  get descriptors(): CapabilityDescriptor[] {
    return Object.keys(driverMethods).flatMap(
      (id) => this.descriptor(id) ?? [],
    );
  }
  descriptor(id: string): CapabilityDescriptor | undefined {
    const names = driverMethods[id as keyof typeof driverMethods];
    if (!names) return;
    const present = names.filter(
      (name) => typeof this.adapter.driver[name] === 'function',
    );
    if (!present.length) return;
    if (present.length !== names.length)
      throw new RobotArmError(
        'INVALID_ADAPTER',
        `Missing driver methods for ${id}: ${names.filter((name) => !present.includes(name)).join(', ')}`,
      );
    const limit = motionLimits[id as keyof typeof motionLimits];
    return {
      id,
      version: 1,
      implementation: 'native',
      constraints: limit && this.adapter.motionLimits?.[limit],
      ...(id === 'control.enable-with-payload' && {
        payload: this.adapter.payloadLimits,
        payloadApplication: {
          requiresDisabled: this.adapter.payloadRequiresDisabled ?? true,
        },
      }),
    };
  }
  method<K extends keyof RobotDriver>(name: K): RobotDriver[K] {
    const driver = this.adapter.driver;
    return driver[name]?.bind(driver) as RobotDriver[K];
  }
  require<K extends keyof RobotDriver>(name: K): NonNullable<RobotDriver[K]> {
    const method = this.method(name);
    if (!method)
      throw new RobotArmError(
        'UNSUPPORTED_CAPABILITY',
        `Driver does not implement ${name}`,
        422,
      );
    return method;
  }
}
