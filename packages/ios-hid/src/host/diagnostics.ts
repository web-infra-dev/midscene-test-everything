import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PointerDiagnostics } from '../pointer/diagnostics.js';

/** Explicit developer mode only: ordinary connections never persist phone frames. */
export function createPointerDiagnostics(
  directory: string,
): PointerDiagnostics {
  let sequence = 0;
  return async ({ stage, before, after, data }) => {
    if (++sequence > 100) return;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const prefix = join(
      directory,
      `${String(sequence).padStart(3, '0')}-${stage}`,
    );
    await Promise.all([
      writeFile(`${prefix}-before.jpg`, before.jpeg, { mode: 0o600 }),
      writeFile(`${prefix}-after.jpg`, after.jpeg, { mode: 0o600 }),
      writeFile(
        `${prefix}.json`,
        JSON.stringify(
          {
            width: before.width,
            height: before.height,
            beforeSequence: before.sequence,
            afterSequence: after.sequence,
            ...data,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      ),
    ]);
  };
}
