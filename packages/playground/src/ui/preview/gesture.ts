import type {
  ScreenAction,
  ScreenPoint,
} from '@midscene/robotics-shared/contracts';
import {
  type PreviewHit,
  type PreviewPoint,
  type PreviewScreenProjection,
  hitTestScreens,
} from './projection';

export const PREVIEW_LONG_PRESS_MS = 500;
export const PREVIEW_DRAG_THRESHOLD_PX = 5;
export const PREVIEW_SWIPE_MIN_MS = 100;
export const PREVIEW_ACTION_MAX_MS = 60000;

export type PreviewGestureDraft =
  | {
      type: 'tap' | 'longPress';
      imagePoint: PreviewPoint;
      screenPoint: ScreenPoint;
      durationMs?: number;
    }
  | {
      type: 'swipe';
      imageFrom: PreviewPoint;
      imageTo: PreviewPoint;
      screenFrom: ScreenPoint;
      screenTo: ScreenPoint;
    };

export interface PreviewGestureResult {
  screenId: string;
  action: ScreenAction;
  target: PreviewScreenProjection;
}

export interface PreviewGestureOptions {
  projections: readonly PreviewScreenProjection[];
  activeId?: string;
  longPressEnabled: boolean;
  longPressMs?: number;
  dragThreshold?: number;
}

/**
 * Pointer-only gesture recognition for one screen action.
 *
 * The recognizer owns no DOM state. It locks the screen at pointer-down when
 * the point is inside one, or at the first screen boundary crossed when the
 * drag starts outside. A gesture never switches screens after it is locked.
 */
export class PreviewGesture {
  private pointerId?: number;
  private target?: PreviewScreenProjection;
  private startedInside = false;
  private startedAt = 0;
  private startImage?: PreviewPoint;
  private previousImage?: PreviewPoint;
  private startScreen?: ScreenPoint;
  private previousScreen?: ScreenPoint;
  private moved = false;
  private lastDraft?: PreviewGestureDraft;

  constructor(private readonly options: PreviewGestureOptions) {}

  get screen(): PreviewScreenProjection | undefined {
    return this.target;
  }

  get draft(): PreviewGestureDraft | undefined {
    return this.lastDraft;
  }

  get active(): boolean {
    return this.pointerId !== undefined;
  }

  /** Returns the hit when the caller has to resolve overlapping screens. */
  start(
    pointerId: number,
    point: PreviewPoint,
    now: number,
    chosen?: PreviewScreenProjection,
  ): PreviewHit | { kind: 'started' } {
    this.cancel();
    this.pointerId = pointerId;
    this.startedAt = now;
    this.startImage = point;
    this.previousImage = point;
    const hit =
      chosen !== undefined
        ? ({ kind: 'screen', hit: chosen } as const)
        : hitTestScreens(
            point,
            this.options.projections,
            this.options.activeId,
          );
    if (hit.kind === 'ambiguous') return hit;
    if (hit.kind === 'outside') {
      this.startedInside = false;
      return { kind: 'started' };
    }
    this.lock(hit.hit, point);
    this.startedInside = true;
    this.emitTap(point);
    return { kind: 'started' };
  }

  /** Resolve an overlap after the operator picked a screen. */
  choose(
    pointerId: number,
    point: PreviewPoint,
    now: number,
    target: PreviewScreenProjection,
  ): void {
    if (this.pointerId !== pointerId) return;
    this.startedAt = now;
    this.startImage = point;
    this.previousImage = point;
    this.lock(target, point);
    this.startedInside = true;
    this.emitTap(point);
  }

  /** Update the held-point feedback after the long-press threshold. */
  tick(now: number): PreviewGestureDraft | undefined {
    if (
      !this.target ||
      !this.options.longPressEnabled ||
      !this.startedInside ||
      this.moved ||
      now - this.startedAt < this.longPressMs
    )
      return this.lastDraft;
    this.lastDraft = {
      type: 'longPress',
      imagePoint: this.startImage!,
      screenPoint: this.startScreen!,
      durationMs: Math.min(
        PREVIEW_ACTION_MAX_MS,
        Math.max(this.longPressMs, now - this.startedAt),
      ),
    };
    return this.lastDraft;
  }

  move(
    pointerId: number,
    point: PreviewPoint,
    now: number,
  ): PreviewGestureDraft | undefined {
    if (this.pointerId !== pointerId || !this.previousImage)
      return this.lastDraft;
    if (!this.target) {
      const hit = hitTestScreens(
        point,
        this.options.projections,
        this.options.activeId,
      );
      if (hit.kind !== 'screen') {
        this.previousImage = point;
        return undefined;
      }
      // Entering from outside: only the portion inside the screen is sent.
      const clipped = hit.hit.clipSegment(this.previousImage, point);
      this.previousImage = point;
      if (!clipped) return undefined;
      this.lock(hit.hit, point);
      this.startImage = clipped.from;
      this.startScreen = clipped.screenFrom;
      this.previousScreen = clipped.screenTo;
      this.moved = true;
      this.lastDraft = {
        type: 'swipe',
        imageFrom: clipped.from,
        imageTo: clipped.to,
        screenFrom: clipped.screenFrom,
        screenTo: clipped.screenTo,
      };
      return this.lastDraft;
    }
    if (
      !this.moved &&
      Math.hypot(point.x - this.startImage!.x, point.y - this.startImage!.y) >
        this.dragThreshold
    ) {
      this.moved = true;
    }
    const clipped = this.target.clipSegment(this.previousImage, point);
    this.previousImage = point;
    if (!clipped) return this.lastDraft;
    this.previousScreen = clipped.screenTo;
    if (this.moved)
      this.lastDraft = {
        type: 'swipe',
        imageFrom: this.startImage!,
        imageTo: clipped.to,
        screenFrom: this.startScreen!,
        screenTo: clipped.screenTo,
      };
    return this.lastDraft;
  }

  end(
    pointerId: number,
    point: PreviewPoint,
    now: number,
  ): PreviewGestureResult | undefined {
    if (this.pointerId !== pointerId || !this.target) {
      this.cancel();
      return undefined;
    }
    const target = this.target;
    const startScreen = this.startScreen;
    const elapsed = Math.min(
      PREVIEW_ACTION_MAX_MS,
      Math.max(0, Math.round(now - this.startedAt)),
    );
    if (!this.moved) {
      if (!this.startedInside || !target.contains(point) || !startScreen) {
        this.cancel();
        return undefined;
      }
      if (elapsed >= this.longPressMs) {
        if (!this.options.longPressEnabled) {
          this.cancel();
          return undefined;
        }
        const durationMs = Math.max(this.longPressMs, elapsed);
        this.cancel();
        return {
          screenId: target.screen.id,
          target,
          action: {
            type: 'longPress',
            point: startScreen,
            durationMs,
          },
        };
      }
      this.cancel();
      return {
        screenId: target.screen.id,
        target,
        action: { type: 'tap', point: startScreen },
      };
    }
    const clipped = this.target.clipSegment(this.previousImage!, point);
    this.previousImage = point;
    const from = this.startScreen;
    const to = clipped?.screenTo ?? this.previousScreen;
    this.cancel();
    if (!from || !to || (from.x === to.x && from.y === to.y)) return undefined;
    return {
      screenId: target.screen.id,
      target,
      action: {
        type: 'swipe',
        from,
        to,
        durationMs: Math.min(
          PREVIEW_ACTION_MAX_MS,
          Math.max(PREVIEW_SWIPE_MIN_MS, elapsed),
        ),
      },
    };
  }

  cancel(): void {
    this.pointerId = undefined;
    this.target = undefined;
    this.startedInside = false;
    this.startedAt = 0;
    this.startImage = undefined;
    this.previousImage = undefined;
    this.startScreen = undefined;
    this.previousScreen = undefined;
    this.moved = false;
    this.lastDraft = undefined;
  }

  private get longPressMs(): number {
    return this.options.longPressMs ?? PREVIEW_LONG_PRESS_MS;
  }

  private get dragThreshold(): number {
    return this.options.dragThreshold ?? PREVIEW_DRAG_THRESHOLD_PX;
  }

  private lock(
    target: PreviewScreenProjection,
    imagePoint: PreviewPoint,
  ): void {
    this.target = target;
    this.startScreen = target.toScreen(imagePoint);
    this.previousScreen = this.startScreen;
  }

  private emitTap(point: PreviewPoint): void {
    this.lastDraft = {
      type: 'tap',
      imagePoint: point,
      screenPoint: this.startScreen!,
    };
  }
}
