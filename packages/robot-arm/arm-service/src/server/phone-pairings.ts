import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Pairing authenticates phone input only; it never grants robot motion. */
export class PhonePairings {
  private tokens = new Map<string, string>();
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  async load() {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    const data = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.pairings))
      throw new Error('Invalid saved phone pairings');
    const tokens = new Map<string, string>();
    const seen = new Set<string>();
    for (const row of data.pairings) {
      if (
        typeof row.cameraId !== 'string' ||
        !row.cameraId ||
        typeof row.token !== 'string' ||
        !/^[a-f0-9-]{36}$/.test(row.token) ||
        tokens.has(row.cameraId) ||
        seen.has(row.token)
      )
        throw new Error('Invalid saved phone pairing');
      tokens.set(row.cameraId, row.token);
      seen.add(row.token);
    }
    this.tokens = tokens;
  }
  camera(token: string) {
    return [...this.tokens].find(([, value]) => value === token)?.[0];
  }
  token(cameraId: string): Promise<string> {
    const work = this.pending.then(async () => {
      const saved = this.tokens.get(cameraId);
      if (saved) return saved;
      const token = randomUUID();
      const next = new Map(this.tokens).set(cameraId, token);
      await mkdir(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({
          version: 1,
          pairings: [...next].map(([cameraId, token]) => ({ cameraId, token })),
        }),
        { mode: 0o600 },
      );
      await rename(temporary, this.file);
      this.tokens = next;
      return token;
    });
    this.pending = work.catch(() => undefined);
    return work;
  }
}
