import { randomUUID } from 'node:crypto';
import type { CameraSessionManager } from '@midscene/arm-kit';
import type { PerspectiveRotation } from '@midscene/arm-kit-shared/camera/vision-types';
import type { CameraCorrection } from '@midscene/arm-kit-shared/contracts';
import { saveStandaloneCorrection } from './camera-preview.js';
import {
  BASE_SCREEN_ID,
  type CameraScreenInfo,
  MAX_CAMERA_SCREENS,
  addCameraScreen,
  removeCameraScreen,
} from './camera-screens.js';
import { MarkerPreview } from './marker-preview.js';

export interface CameraCalibrationTarget {
  key: string;
  screenId?: string;
  name: string;
  base: boolean;
  hasCorrection: boolean;
  preview?: MarkerPreview;
}

export interface CameraCalibrationTargetStatus {
  key: string;
  screenId?: string;
  name: string;
  base: boolean;
  hasCorrection: boolean;
  claimed: boolean;
  state: string;
  pageKey?: string;
}

export interface CameraCalibrationDetection {
  correction: CameraCorrection;
  jpeg: string;
  markerIds: number[];
  validFrames: number;
  frameCount: number;
  jitterPx: number;
  errorPx: number;
  screenWidthPx: number;
  screenHeightPx: number;
  rotation: PerspectiveRotation;
}

export interface CameraCalibrationResult {
  key: string;
  screenId?: string;
  name: string;
  base: boolean;
  ok: boolean;
  detection?: CameraCalibrationDetection;
  error?: string;
}

function targetFromScreen(screen: CameraScreenInfo): CameraCalibrationTarget {
  return {
    key: screen.id,
    screenId: screen.base ? undefined : screen.id,
    name: screen.name,
    base: screen.base,
    hasCorrection: screen.hasCorrection,
  };
}

/**
 * One host calibration round for one camera. The host shows one bind QR; every
 * phone that scans it claims the next target and receives its own marker page.
 */
export class CameraCalibrationSession {
  readonly token = randomUUID();
  readonly bindToken = randomUUID();
  lastViewed = Date.now();
  private readonly targets: CameraCalibrationTarget[];
  private readonly createdScreenIds = new Set<string>();
  private detections: CameraCalibrationResult[] = [];
  private applied = false;
  private closed = false;
  private bindChain = Promise.resolve();

  constructor(
    readonly cameraId: string,
    screens: CameraScreenInfo[],
  ) {
    this.targets = screens.map(targetFromScreen);
  }

  get previews() {
    return this.targets.flatMap((target) =>
      target.preview ? [target.preview] : [],
    );
  }

  /** Claim the next target for a newly scanned phone. */
  bind(cameras: CameraSessionManager): Promise<MarkerPreview> {
    const pending = this.bindChain.then(() => this.bindNext(cameras));
    this.bindChain = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async bindNext(
    cameras: CameraSessionManager,
  ): Promise<MarkerPreview> {
    if (this.closed) throw new Error('Calibration session is closed');
    let target = this.targets.find((entry) => !entry.preview);
    if (!target) {
      if (this.targets.length >= MAX_CAMERA_SCREENS)
        throw Object.assign(
          new Error(`A camera supports at most ${MAX_CAMERA_SCREENS} screens`),
          { status: 409 },
        );
      const screen = await addCameraScreen(cameras, this.cameraId);
      this.createdScreenIds.add(screen.id);
      target = {
        key: screen.id,
        screenId: screen.id,
        name: screen.name,
        base: false,
        hasCorrection: false,
      };
      this.targets.push(target);
    }
    if (this.closed) throw new Error('Calibration session is closed');
    const slot = this.targets.indexOf(target) + 1;
    const preview = new MarkerPreview(this.cameraId, slot, target.screenId);
    target.preview = preview;
    this.lastViewed = Date.now();
    return preview;
  }

  status(): CameraCalibrationTargetStatus[] {
    return this.targets.map((target) => {
      const status = target.preview?.status();
      return {
        key: target.key,
        screenId: target.screenId,
        name: target.name,
        base: target.base,
        hasCorrection: target.hasCorrection,
        claimed: Boolean(target.preview),
        state: status?.state ?? 'unclaimed',
        ...(status?.pageKey ? { pageKey: status.pageKey } : {}),
      };
    });
  }

  async detect(
    cameras: CameraSessionManager,
    signal: AbortSignal,
  ): Promise<CameraCalibrationResult[]> {
    const results: CameraCalibrationResult[] = [];
    for (const target of this.targets) {
      if (!target.preview) continue;
      const status = target.preview.status();
      if (status.state !== 'ready' || !status.pageKey) {
        results.push({
          key: target.key,
          screenId: target.screenId,
          name: target.name,
          base: target.base,
          ok: false,
          error: 'Screen is not ready. Keep it visible and in fullscreen.',
        });
        continue;
      }
      try {
        const detection = await target.preview.capture(
          cameras,
          status.pageKey,
          signal,
        );
        results.push({
          key: target.key,
          screenId: target.screenId,
          name: target.name,
          base: target.base,
          ok: true,
          detection,
        });
      } catch (error) {
        results.push({
          key: target.key,
          screenId: target.screenId,
          name: target.name,
          base: target.base,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.detections = results;
    this.lastViewed = Date.now();
    return results;
  }

  async apply(cameras: CameraSessionManager) {
    const succeeded = this.detections.filter(
      (result) => result.ok && result.detection,
    );
    const applied: CameraCalibrationResult[] = [];
    const failed: CameraCalibrationResult[] = [];
    for (const result of succeeded) {
      try {
        await saveStandaloneCorrection(
          cameras,
          this.cameraId,
          result.detection!.correction,
          {
            width: result.detection!.screenWidthPx,
            height: result.detection!.screenHeightPx,
            rotation: result.detection!.rotation,
          },
          result.screenId,
        );
        applied.push(result);
      } catch (error) {
        failed.push({
          ...result,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (applied.length) this.applied = true;
    this.lastViewed = Date.now();
    return { applied, failed };
  }

  async close(cameras: CameraSessionManager): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.bindChain;
    for (const preview of this.previews) preview.close();
    if (!this.applied) {
      for (const screenId of this.createdScreenIds)
        await removeCameraScreen(cameras, this.cameraId, screenId).catch(
          () => undefined,
        );
    }
  }
}
