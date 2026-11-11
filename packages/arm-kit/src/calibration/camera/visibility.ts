import { setTimeout as delay } from 'node:timers/promises';
import type { CalibrationPageUpdate } from '../../assisted-contracts.js';
import {
  type VisibilityScreen,
  measureScreenVisibility,
} from '../../camera/screen-visibility.js';
import { RobotArmError } from '../../contracts.js';
import { sameLayout } from '../phone/session.js';

export interface VisibilityPhone extends VisibilityScreen {
  name?: string;
  show(phase: 0 | 1): string;
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
) {
  const requests = new Map<VisibilityPhone, string>();
  const identities = new Map<VisibilityPhone, CalibrationPageUpdate>();
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
            !sameLayout(update.layout, original.layout)))
      )
        throw new RobotArmError(
          'VISIBILITY_UNAVAILABLE',
          'A phone page or display changed during visibility verification.',
        );
    }
  };
  const capture = async () => {
    const frames: Buffer[] = [];
    for (const phase of [0, 1, 0] as const) {
      signal.throwIfAborted();
      check();
      for (const phone of phones) {
        const previous = requests.get(phone);
        if (previous) phone.clear(previous);
        requests.set(phone, phone.show(phase));
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
      })),
    );
    assertCurrent();
    return result;
  };
  try {
    const result = await capture();
    return result.clear ? result : await capture();
  } finally {
    for (const [phone, id] of requests) phone.clear(id);
  }
}
