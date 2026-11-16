// Ported upstream simulation scenarios; acceptance is tested separately in Arm Kit.
import { describe, expect, it } from '@rstest/core';
import { fitExploration } from '../src/calibration/exploration/fit.js';
import { runAutoExploration } from '../src/calibration/exploration/sampler.js';
import type {
  ApplicationContext,
  AutoExplorationHost,
  CalibrationSession,
} from '../src/calibration/exploration/types.js';

import type {
  CartesianPose,
  MotionAcceleration,
  MotionSpeed,
} from '../src/contracts.js';
import { contactPoint } from '../src/domain.js';
import {
  scaleAcceleration,
  scaleSpeed,
} from '../src/screen-interaction/motion-policy.js';
import { fixture, pose } from './fixtures.js';

describe('first-time automatic exploration', () => {
  it.each([
    'standard',
    'standard-tilt',
    'fast-local-recovery',
    'fast-tap',
    'fast-slide',
    'fast-refine-stalled',
    'fast-adaptive-slide',
    'fast-hysteresis',
    'fast-offset-hysteresis',
    'fast-reported-failure',
    'press-recovers',
    'bad-validation',
    'fast-no-touch',
    'fast-delayed',
    'initial-touch-offset',
    'release-missing',
    'repress-missing',
    'snapshot-missing',
    'snapshot-stale',
    'safety-floor',
  ])(
    'explores with %s and preserves independent acceptance',
    async (mode) => {
      const f = await fixture();
      const page = {
        id: 'page',
        connected: true,
        display: { width: 400, height: 800, visible: true },
        config: { pixelWidth: 1000, pixelHeight: 500 },
        mapping: { version: 1, displayKey: 'display' },
        cursor: 0,
        sampleId: undefined as string | undefined,
        sampleAcked: false,
        sampleSnapshot: undefined as
          | undefined
          | {
              sampleId: string;
              mappingVersion: number;
              pointerCount: number;
              screen: { x: number; y: number } | null;
            },
      };
      const startZ = mode === 'fast-reported-failure' ? -194.62645 : 60;
      const activationZ =
        mode === 'fast-reported-failure'
          ? -202.37645
          : mode === 'fast-offset-hysteresis'
            ? 30.7
            : 30;
      const releaseZ =
        mode === 'fast-reported-failure'
          ? -200.12645
          : mode.includes('hysteresis')
            ? activationZ + 2.5
            : activationZ;
      let previousHeld = false;
      let missedPress = false;
      let contact: { x: number; y: number; z: number } | undefined;
      let touching = false;
      let releaseProbeStarted = false;
      let repressing = false;
      let delayedUntil = 0;
      let delayedOnce = false;
      let delayedMoveCount = 0;
      const motions: CartesianPose[] = [];
      let actualPose = pose(100, -50, startZ);
      const finishedSampling = false;
      let missedSlide = false;
      let refining = false;
      let lowestZ = Number.POSITIVE_INFINITY;
      const isFast = !mode.startsWith('standard') && mode !== 'safety-floor';
      const tilted = mode === 'standard-tilt';
      const slopeX = tilted ? 0.015 : 0;
      const pagePixel = () =>
        contact && touching
          ? {
              x: (contact.x / 200) * 999,
              y: (-contact.y / 100) * 499,
            }
          : null;
      const targets = [
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 1],
        [1, 2],
        [2, 0],
        [2, 1],
        [2, 2],
      ].map(([row, column]) => {
        const x = [100, 500, 900][column];
        const y = [50, 250, 450][row];
        return {
          id: `grid-${row}-${column}`,
          role:
            (row === 1 && (column === 0 || column === 2)) ||
            (row === 2 && column === 1)
              ? ('validation' as const)
              : ('fit' as const),
          css: { x: x / 2.5, y: y / 2 },
          screen: { x, y },
        };
      });
      const screenCalib = {
        findMappedSession: async () => ({ ...page }),
        session: async () => {
          if (Date.now() < delayedUntil)
            expect(motions).toHaveLength(delayedMoveCount);
          return {
            ...page,
            sampleSnapshot:
              mode === 'snapshot-missing' || Date.now() < delayedUntil
                ? undefined
                : mode === 'snapshot-stale' && page.sampleSnapshot
                  ? { ...page.sampleSnapshot, sampleId: 'old-height' }
                  : page.sampleSnapshot,
          };
        },
        setSample: async (_id: string, sampleId: string, purpose: string) => {
          let screen = pagePixel();
          if (
            mode === 'fast-adaptive-slide' &&
            purpose === 'slide' &&
            !missedSlide
          ) {
            missedSlide = true;
            screen = null;
          }
          if (
            mode === 'press-recovers' &&
            !missedPress &&
            purpose === 'press'
          ) {
            missedPress = true;
            screen = null;
          }
          if (mode === 'fast-delayed' && purpose === 'press' && !delayedOnce) {
            delayedOnce = true;
            delayedUntil = Date.now() + 350;
            delayedMoveCount = motions.length;
          }
          if (screen && mode === 'initial-touch-offset' && !repressing)
            screen.x += 20;
          if (
            screen &&
            mode === 'bad-validation' &&
            targets.some(
              (target) =>
                target.role === 'validation' &&
                Math.hypot(
                  target.screen.x - screen.x,
                  target.screen.y - screen.y,
                ) < 1,
            )
          )
            screen.x += 20;
          page.sampleId = sampleId;
          page.sampleAcked = true;
          page.sampleSnapshot = {
            sampleId,
            mappingVersion: 1,
            pointerCount: screen ? 1 : 0,
            screen,
          };
          return { ...page };
        },
        targets: async () => ({
          mappingVersion: 1,
          displayKey: 'display',
          pixelWidth: 1000,
          pixelHeight: 500,
          targets,
        }),
        events: async () => {
          throw new Error('Sampling must use a fresh pointer snapshot');
        },
      } as AutoExplorationHost['screenCalib'];
      const ctx: ApplicationContext = {
        tool: f.tool,
        screen: {
          ...f.screen,
          physicalWidthMm: 0,
          physicalHeightMm: 0,
        },
      };
      const session: CalibrationSession = { auto: {} };
      const constraints = {
        speed: {
          ratio: { min: 0.001, max: 1 },
          linear: { min: 0.01, max: 1000 },
          angular: { min: 0.01, max: 360 },
          joints: { min: 0.01, max: 360 },
        },
        acceleration: {
          ratio: { min: 0.001, max: 1 },
          linear: { min: 0.01, max: 1000 },
          angular: { min: 0.01, max: 360 },
          joints: { min: 0.01, max: 360 },
        },
      };
      let finalPress = false;
      let finalPressCount = 0;
      const host = {
        adapter: {
          ...f.adapter,
          capabilities: f.runtime.capabilities,
          resolver: {
            descriptor: (token: string) =>
              token === 'motion.linear' ? { constraints } : undefined,
          },
          getPose: async () => pose(100, -50, startZ),
        },
        profileStore: { saveSession: async () => undefined },
        check: () => undefined,
        interrupted: () => false,
        ready: async () => undefined,
        drag: async () => undefined,
        target: () => undefined,
        preflight: async ([step]: Parameters<
          AutoExplorationHost['preflight']
        >[0]) => {
          finalPress = step.name.endsWith(' press');
          refining = step.name.endsWith(' refine');
        },
        move: async (
          target: CartesianPose,
          _ctx: unknown,
          speed: MotionSpeed,
          acceleration: MotionAcceleration,
        ) => {
          const factor = isFast || finalPress ? 0.25 : 0.1;
          expect(speed).toEqual(scaleSpeed(ctx.screen.actionSpeed, factor));
          expect(acceleration).toEqual(
            scaleAcceleration(ctx.screen.actionAcceleration, factor),
          );
          if (finalPress) finalPressCount++;
          finalPress = false;
          const measured = structuredClone(target);
          if (mode === 'fast-slide') measured.positionMm.z += 0.04;
          if (mode === 'fast-refine-stalled' && refining)
            measured.positionMm.z +=
              activationZ - contactPoint(target, f.tool.offsetMm).z;
          const point = contactPoint(measured, f.tool.offsetMm);
          const previous = contactPoint(actualPose, f.tool.offsetMm);
          if (!finishedSampling) motions.push(target);
          if (point.z > previous.z && previous.z <= 30)
            releaseProbeStarted = true;
          if (releaseProbeStarted && point.z < previous.z) repressing = true;
          actualPose = measured;
          contact = point;
          lowestZ = Math.min(lowestZ, point.z);
          previousHeld = touching;
          const inside =
            point.x >= 0 && point.x <= 200 && point.y <= 0 && point.y >= -100;
          const tiltOffset = tilted
            ? slopeX * (point.x - 100) - 0.005 * (point.y + 50)
            : 0;
          touching =
            inside &&
            (touching
              ? point.z < releaseZ + tiltOffset
              : point.z <= activationZ + tiltOffset);
          if (mode === 'release-missing' && releaseProbeStarted)
            touching = true;
          if (mode === 'repress-missing' && repressing) touching = false;
          if (mode === 'fast-no-touch' && point.x < 50) touching = false;
          if (mode === 'fast-local-recovery' && point.x < 50)
            touching = inside && point.z <= activationZ - 0.75;
          // A remote point that only touches at the floor would need a final
          // press below that floor. It must be rejected before submission.
          if (mode === 'safety-floor' && point.x > 105)
            touching = point.z <= 27.625;
          return measured;
        },
        stable: async () => undefined,
        stationaryPose: async () => pose(100, -50, startZ),
        contactAction: async () => {
          throw new Error('unused');
        },
        safeLift: (p: CartesianPose) => p,
        validateCalibration: () => undefined,
        validateScreenTargets: () => undefined,
        currentPose: async () => actualPose,
        screenCalib,
        progress: (current: CalibrationSession) => {
          if (current.auto?.progress?.message === 'Initial touch · refine')
            expect(previousHeld).toBe(false);
        },
      };
      const job = runAutoExploration(host as never, session, ctx, {
        startPose: pose(100, -50, startZ),
        ...(isFast
          ? {
              mode: 'fast-horizontal' as const,
              horizontalConfirmed: true,
              collection: mode.endsWith('slide')
                ? ('slide' as const)
                : ('tap' as const),
            }
          : {}),
      });
      try {
        const expected: Record<string, string> = {
          'release-missing': 'No confirmed release',
          'repress-missing': 'refined press',
          'snapshot-missing': 'Phone step acknowledgement timed out',
          'snapshot-stale': 'Phone step acknowledgement timed out',
          'safety-floor': 'safety floor',
          'fast-no-touch': 'fast local height-search budget',
          'fast-refine-stalled': 'could not narrow the contact interval',
        };
        if (expected[mode]) {
          await expect(job).rejects.toThrow(expected[mode]);
          if (mode.startsWith('snapshot-')) expect(motions).toHaveLength(0);
          if (mode === 'fast-refine-stalled')
            expect(session.auto?.collectedSamples).toBeUndefined();
          if (mode === 'safety-floor')
            expect(lowestZ).toBeGreaterThanOrEqual(27.625);
          if (mode === 'fast-no-touch') {
            expect(lowestZ).toBeGreaterThanOrEqual(27.625);
            expect(session.auto?.collectedSamples).toHaveLength(3);
            expect(session.auto?.fastAdaptation?.searchSteps).toBe(12);
          }
          return;
        }
        const collection = await job;
        expect(collection.probes).toHaveLength(3);
        expect(collection.grid).toHaveLength(isFast ? 6 : 9);
        if (mode === 'standard') expect(finalPressCount).toBe(12);
        const fit = () =>
          fitExploration(
            collection,
            f.tool,
            f.runtime.capabilities,
            {
              id: 'candidate',
              ...f.binding,
              robotGeometryRevision: 1,
              toolGeometryRevision: 1,
              screenGeometryRevision: 1,
            },
            isFast,
          );
        if (mode === 'bad-validation') {
          const result = fit();
          expect(result.evidence.validationMaxPx).toBeCloseTo(20);
          expect(result.warnings).toContainEqual(
            expect.objectContaining({ label: 'Holdout maximum' }),
          );
          expect(result.candidate.acceptanceStatus).toBe('pending');
          return;
        }
        const result = fit();
        if (mode === 'fast-local-recovery') {
          const recovered = collection.grid[0];
          expect(recovered.recovered).toBe(true);
          const [touchZ, clearZ] = recovered.heightIntervalMm!;
          expect(recovered.pressedZ).toBeCloseTo(
            touchZ - (clearZ - touchZ) / 2,
            6,
          );
          expect(collection.grid[1].recovered).toBeUndefined();
          expect(result.evidence.planeSource).toBe('assumed-horizontal');
          return;
        }
        if (tilted) {
          const { normal } = result.candidate.plane;
          expect(-normal.x / normal.z).toBeCloseTo(slopeX, 2);
          expect(-normal.y / normal.z).toBeCloseTo(-0.005, 2);
        }
        expect(result.candidate.acceptanceStatus).toBe('pending');
        // The simulated screen maps pixels in XY; the measured axes follow its surface.
        const sizePrecision = tilted ? 1 : 3;
        expect(result.measuredSize.physicalWidthMm).toBeCloseTo(
          tilted ? Math.hypot(200, slopeX * 200) : 200,
          sizePrecision,
        );
        expect(result.measuredSize.physicalHeightMm).toBeCloseTo(
          tilted ? Math.hypot(100, 0.5) : 100,
          sizePrecision,
        );
        expect(result.coverage).toBeGreaterThan(0.6);
        expect(result.gridRmsMm).toBeLessThan(0.75);
        expect(result.evidence.validationMaxMm).toBeLessThan(1);
        expect(result.evidence.planeSource).toBe(
          isFast ? 'assumed-horizontal' : 'measured',
        );
        const methods = session.auto?.collectedSamples?.map((p) => p.method);
        if (mode === 'fast-slide' || mode === 'fast-tap') {
          expect(result.evidence.validationHeightMaxMm).toBeUndefined();
          expect(methods).toEqual([
            'stepped',
            'direct',
            'direct',
            'direct',
            ...Array(5).fill(mode === 'fast-slide' ? 'slide' : 'direct'),
          ]);
          expect(finalPressCount).toBe(1);
        }
        if (mode === 'fast-slide') {
          const first = collection.probes[0];
          expect(first.heightIntervalMm?.[0]).toBeLessThanOrEqual(activationZ);
          expect(first.heightIntervalMm?.[1]).toBeGreaterThan(activationZ);
          const [touchZ, clearZ] = first.heightIntervalMm!;
          expect(first.pressedZ).toBeCloseTo(touchZ - (clearZ - touchZ) / 2, 6);
          for (const point of [...collection.probes, ...collection.grid]) {
            expect(point.pressedZ).toBeCloseTo(first.pressedZ, 6);
            expect(point.contact.z).toBeCloseTo(first.contact.z, 6);
          }
        }
        if (mode === 'fast-adaptive-slide') {
          expect(missedSlide).toBe(true);
          expect(methods?.slice(4)).toEqual([
            'direct',
            'slide',
            'slide',
            'slide',
            'slide',
          ]);
        }
        if (mode === 'press-recovers') expect(missedPress).toBe(true);
        expect(f.store.getScreen(f.screen.id)).toEqual(f.screen);
      } finally {
        await f.cleanup();
      }
    },
    90000,
  );
});
