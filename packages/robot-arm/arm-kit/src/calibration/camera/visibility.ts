import { setTimeout as delay } from 'node:timers/promises';
import type { CalibrationPageUpdate } from '../../assisted-contracts.js';
import {
  type VisibilityScreen,
  combineGlareExposureEvidence,
  measureScreenVisibility,
} from '../../camera/screen-visibility.js';
import {
  RobotArmError,
  type ScreenVisibilityEvidence,
  type ScreenVisibilityProbePattern,
} from '../../contracts.js';
import { sameLayout } from '../phone/session.js';

export interface VisibilityPhone extends VisibilityScreen {
  name?: string;
  show(phase: 0 | 1, pattern?: ScreenVisibilityProbePattern): string;
  observation(id: string): CalibrationPageUpdate | undefined;
  clear(id: string): void;
}

export async function confirmVisibilityPages(
  phones: readonly VisibilityPhone[],
  signal: AbortSignal,
  check: () => void,
): Promise<void> {
  const requests = new Map<VisibilityPhone, string>();
  try {
    for (const phone of phones) {
      signal.throwIfAborted();
      check();
      requests.set(phone, phone.show(0));
    }
    const deadline = performance.now() + 12_000;
    while (true) {
      signal.throwIfAborted();
      check();
      const missing = [...requests].filter(
        ([phone, id]) => !phone.observation(id),
      );
      if (!missing.length) return;
      if (performance.now() >= deadline)
        throw new RobotArmError(
          'VISIBILITY_UNAVAILABLE',
          'The paired phones did not acknowledge the visibility pattern. Keep every page visible and fullscreen.',
          409,
          { screens: missing.map(([phone]) => phone.name ?? phone.id) },
        );
      await delay(50, undefined, { signal });
    }
  } finally {
    for (const [phone, id] of requests) phone.clear(id);
  }
}

/** All pages change together. An acknowledgement alone never substitutes for image evidence. */
export async function verifyScreenVisibility(
  phones: readonly VisibilityPhone[],
  frame: () => Promise<Buffer>,
  signal: AbortSignal,
  check: () => void,
  options?: {
    includeUndetected?: boolean;
    sharedParking?: boolean;
    retainMasks?: boolean;
    assertStationary?(): Promise<void>;
    withReducedExposure?(
      capture: (exposure: {
        previous: number;
        reduced: number;
      }) => Promise<ScreenVisibilityEvidence>,
    ): Promise<ScreenVisibilityEvidence | undefined>;
  },
) {
  const requests = new Map<VisibilityPhone, string>();
  const identities = new Map<VisibilityPhone, CalibrationPageUpdate>();
  const attempts: NonNullable<ScreenVisibilityEvidence['attempts']> = [];
  const assertCurrent = () => {
    signal.throwIfAborted();
    check();
    for (const [phone, id] of requests) {
      const update = phone.observation(id);
      const original = identities.get(phone);
      if (
        !update ||
        (original &&
          (update.pageId !== original.pageId ||
            update.browserInstanceId !== original.browserInstanceId ||
            update.visibilityFirstRowHeight !==
              original.visibilityFirstRowHeight ||
            !sameLayout(update.layout, original.layout)))
      )
        throw new RobotArmError(
          'VISIBILITY_UNAVAILABLE',
          'A phone page or display changed during visibility verification.',
        );
    }
  };
  const capture = async (
    pattern: ScreenVisibilityProbePattern,
    exposure?: { previous: number; reduced: number },
  ) => {
    await options?.assertStationary?.();
    const frames: Buffer[] = [];
    for (const phase of [0, 1, 0] as const) {
      signal.throwIfAborted();
      check();
      for (const phone of phones) {
        const previous = requests.get(phone);
        if (previous) phone.clear(previous);
        requests.set(phone, phone.show(phase, pattern));
      }
      const deadline = performance.now() + 4000;
      while ([...requests].some(([phone, id]) => !phone.observation(id))) {
        signal.throwIfAborted();
        check();
        if (performance.now() >= deadline)
          throw new RobotArmError(
            'VISIBILITY_UNAVAILABLE',
            'The paired phones did not acknowledge the visibility pattern. Keep every page visible and fullscreen.',
          );
        await delay(50, undefined, { signal });
      }
      for (const [phone, id] of requests)
        if (!identities.has(phone))
          identities.set(phone, phone.observation(id)!);
      assertCurrent();
      // Allow phone compositing, camera exposure and buffered capture to settle.
      await delay(300, undefined, { signal });
      assertCurrent();
      frames.push(await frame());
      assertCurrent();
    }
    const result = await measureScreenVisibility(
      frames,
      phones.map((phone) => ({
        ...phone,
        layout: identities.get(phone)!.layout,
        firstRowHeight: identities.get(phone)!.visibilityFirstRowHeight,
      })),
      {
        pattern,
        includeUndetected:
          pattern === 'checkerboard' ||
          options?.includeUndetected ||
          options?.sharedParking,
        sharedParking: options?.sharedParking,
        retainMasks: options?.sharedParking || options?.retainMasks,
      },
    );
    await options?.assertStationary?.();
    assertCurrent();
    if (options?.sharedParking)
      attempts.push({ pattern, exposure, screens: result.screens });
    return result;
  };
  const finish = (
    evidence: ScreenVisibilityEvidence,
    screens: ScreenVisibilityEvidence['screens'],
  ): ScreenVisibilityEvidence => {
    const reportScreen = ({
      sampleMasks,
      ...summary
    }: ScreenVisibilityEvidence['screens'][number]) =>
      options?.retainMasks && sampleMasks
        ? { ...summary, sampleMasks }
        : summary;
    return {
      ...evidence,
      clear: screens.every((screen) => screen.clear === true),
      screens: screens.map(reportScreen),
      attempts: attempts.map((attempt) => ({
        ...attempt,
        screens: attempt.screens.map(reportScreen),
      })),
    };
  };
  try {
    const primary = await capture('checkerboard');
    if (primary.clear) return primary;
    const fallback = await capture('offset-contrast');
    if (!options?.sharedParking) return fallback;
    const normal = fallback.screens.map((screen, index) => {
      if (screen.clear) return { ...screen, verifiedBy: { attempts: [2] } };
      const first = primary.screens[index];
      return options.assertStationary && first?.clear && first.id === screen.id
        ? { ...first, verifiedBy: { attempts: [1] } }
        : screen;
    });

    const glare = new Set(
      [...primary.screens, ...fallback.screens]
        .filter(({ reason }) => reason === 'glare')
        .map(({ id }) => id),
    );
    if (
      !normal.some(
        ({ id, clear, assessment }) =>
          !clear && (glare.has(id) || assessment === 'insufficient-evidence'),
      )
    )
      return finish(fallback, normal);

    // Bracket only when a screen still needs glare evidence at this pose.
    const reduced = normal.some(({ id, clear }) => !clear && glare.has(id))
      ? await options.withReducedExposure?.((exposure) =>
          capture('offset-contrast', exposure),
        )
      : undefined;
    const retry = reduced ?? (await capture('offset-contrast'));
    assertCurrent();
    const screens = retry.screens.map(
      (screen, index): ScreenVisibilityEvidence['screens'][number] => {
        const previous = normal[index];
        if (
          options.assertStationary &&
          previous.clear &&
          previous.id === screen.id
        )
          return previous;
        if (screen.clear) return { ...screen, verifiedBy: { attempts: [3] } };
        const combined =
          options.assertStationary &&
          reduced &&
          combineGlareExposureEvidence(fallback.screens[index], screen);
        if (combined)
          return {
            ...combined.screen,
            verifiedBy: {
              attempts: [2, 3],
              recoveredGlareSamples: combined.recoveredGlareSamples,
            },
          };
        return glare.has(screen.id)
          ? { ...screen, assessment: 'insufficient-evidence', reason: 'glare' }
          : screen;
      },
    );
    return finish(retry, screens);
  } finally {
    for (const [phone, id] of requests) phone.clear(id);
  }
}
