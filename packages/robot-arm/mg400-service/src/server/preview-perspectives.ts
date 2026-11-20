import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CameraCorrection, CameraSessionManager } from '@midscene/arm-kit';
import type { CalibrationPageLayout } from '@midscene/robotics-shared/assisted-contracts';
import type { PerspectiveTarget } from '@midscene/robotics-shared/camera/vision-types';
import { saveStandaloneCorrection } from './camera-preview.js';

export function phoneFingerprint(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

interface PreviewPerspective {
  scope: string;
  phones: string[];
}

/** Keep optical edits away from installed screens until their phone binding is known. */
export class PreviewPerspectives {
  constructor(private readonly cameras: CameraSessionManager) {}
  private file(cameraId: string) {
    return join(
      this.cameras.dataDirectory,
      `${phoneFingerprint(cameraId)}.marker-preview.json`,
    );
  }
  async get(cameraId: string): Promise<PreviewPerspective | undefined> {
    try {
      return JSON.parse(await readFile(this.file(cameraId), 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  async save(
    cameraId: string,
    correction: CameraCorrection,
    target: PerspectiveTarget,
    phones: string[],
    check: () => CalibrationPageLayout | undefined,
    allowMismatch = false,
  ) {
    const previous = await this.get(cameraId);
    const scope = `marker-preview:${randomUUID()}`;
    const file = this.file(cameraId);
    const tmp = `${file}.${randomUUID()}`;
    let validity;
    try {
      validity = await saveStandaloneCorrection(
        this.cameras,
        cameraId,
        correction,
        target,
        scope,
        check,
        allowMismatch,
      );
      await mkdir(this.cameras.dataDirectory, { recursive: true });
      await writeFile(tmp, JSON.stringify({ scope, phones }), { mode: 0o600 });
      check();
      await rename(tmp, file);
    } catch (error) {
      await this.cameras.clearPerspective(cameraId, scope);
      throw error;
    } finally {
      await rm(tmp, { force: true });
    }
    if (previous) await this.cameras.clearPerspective(cameraId, previous.scope);
    return validity;
  }
  async clear(cameraId: string, pending: PreviewPerspective) {
    await rm(this.file(cameraId), { force: true });
    await this.cameras.clearPerspective(cameraId, pending.scope);
  }
}
