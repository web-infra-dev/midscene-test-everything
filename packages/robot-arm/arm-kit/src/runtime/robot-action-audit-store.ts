import { appendFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  RobotActionAuditKind,
  RobotActionAuditOutcome,
  RobotActionAuditRecord,
  RobotActionAuditStatus,
} from '../contracts.js';
import { robotAuditDirectory } from '../storage/layout.js';

// The record and status shapes are the wire protocol for GET /audit/actions and
// live in the browser-safe contracts; re-exported here for callers that only
// need the store.
export type {
  RobotActionAuditKind,
  RobotActionAuditOutcome,
  RobotActionAuditRecord,
  RobotActionAuditStatus,
};

/**
 * Append-only JSONL audit trail for physical operations.
 *
 * The runtime records what it asked the arm to do and how it ended, so an
 * operator can reconstruct what happened immediately before a fault. The
 * controller's own logs cannot do that: they show commands, not the intent,
 * bindings and outcome that produced them.
 *
 * Record shape, one JSON object per line:
 *
 *   { schemaVersion, seq, at, kind, id, outcome, error?, detail? }
 *
 * - `seq` is monotonic within a process, so a rotated or truncated file can
 *   still be ordered.
 * - `id` is the action `requestId` when there is one, otherwise the operation id.
 * - `detail` is deliberately free-form per event kind; see the runtime call sites
 *   for what each kind records.
 *
 * Two properties matter more than completeness:
 *
 * 1. **A failing audit write never fails or blocks an operation.** A full disk
 *    must not be able to prevent an emergency stop, so every write error is
 *    swallowed, counted and reported through the callback, and `record()` never
 *    rejects. Callers use it fire-and-forget and may `flush()` when they need
 *    determinism.
 * 2. **A crash cannot corrupt earlier lines.** Writes are serialized and only
 *    ever append, so a torn final line is the worst case; `load()` skips lines
 *    it cannot parse rather than refusing the whole file.
 */
export const ROBOT_ARM_AUDIT_SCHEMA_VERSION = 1;
export const DEFAULT_ROBOT_ARM_AUDIT_MAX_BYTES = 10 * 1024 * 1024;
/** How many records the in-memory index keeps for `GET /audit/actions`. */
export const DEFAULT_ROBOT_ARM_AUDIT_RECENT = 200;

export interface RobotActionAuditInput {
  kind: RobotActionAuditKind;
  id: string;
  outcome: RobotActionAuditOutcome;
  error?: string;
  errorDetails?: RobotActionAuditRecord['errorDetails'];
  detail?: Record<string, unknown>;
}

export interface RobotActionAuditStoreOptions {
  /**
   * Target file. Defaults to midscene_run/log/robot-arm/standalone/actions.jsonl.
   * Pass `false`, `''` or `'0'` to disable.
   */
  filePath?: string | false | null;
  maxBytes?: number;
  recentLimit?: number;
  /** Observes write failures without changing control flow. */
  onError?: (error: unknown) => void;
}

const defaultFilePath = () => join(robotAuditDirectory(), 'actions.jsonl');

const resolveFilePath = (
  value: RobotActionAuditStoreOptions['filePath'],
): string | undefined => {
  if (value === undefined || value === null) return defaultFilePath();
  if (value === false) return undefined;
  const trimmed = String(value).trim();
  if (trimmed === '' || trimmed === '0') return undefined;
  return trimmed;
};

export class RobotActionAuditStore {
  readonly filePath?: string;
  readonly maxBytes: number;
  private readonly recentLimit: number;
  private readonly onError?: (error: unknown) => void;
  private recentRecords: RobotActionAuditRecord[] = [];
  private seq = 0;
  private written = 0;
  private failures = 0;
  private lastError?: string;
  private bytes = 0;
  /** Serializes appends; every entry settles, so the chain never rejects. */
  private serial: Promise<void> = Promise.resolve();

  constructor(options: RobotActionAuditStoreOptions = {}) {
    this.filePath = resolveFilePath(options.filePath);
    this.maxBytes =
      Number.isFinite(options.maxBytes) && (options.maxBytes as number) > 0
        ? (options.maxBytes as number)
        : DEFAULT_ROBOT_ARM_AUDIT_MAX_BYTES;
    this.recentLimit =
      Number.isInteger(options.recentLimit) &&
      (options.recentLimit as number) > 0
        ? (options.recentLimit as number)
        : DEFAULT_ROBOT_ARM_AUDIT_RECENT;
    this.onError = options.onError;
  }

  get enabled(): boolean {
    return this.filePath !== undefined;
  }

  /**
   * Read the tail of the file into the in-memory index so the query route is
   * useful immediately after a restart. Unreadable or malformed files degrade
   * to an empty index instead of failing startup.
   */
  async load(): Promise<void> {
    if (!this.filePath) return;
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.noteFailure(error);
      return;
    }
    this.bytes = Buffer.byteLength(raw);
    const records: RobotActionAuditRecord[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as RobotActionAuditRecord;
        if (parsed && typeof parsed.seq === 'number') records.push(parsed);
      } catch {
        // A torn final line after a crash is expected; skip it, keep the rest.
      }
    }
    this.recentRecords = records.slice(-this.recentLimit);
    this.seq = records.reduce((max, r) => Math.max(max, r.seq), 0);
  }

  /**
   * Append one record. Never rejects and never throws synchronously, so a
   * caller can treat auditing as best-effort without a try/catch.
   */
  record(input: RobotActionAuditInput): Promise<void> {
    if (!this.filePath) return Promise.resolve();
    let entry: RobotActionAuditRecord;
    let line: string;
    try {
      entry = {
        schemaVersion: ROBOT_ARM_AUDIT_SCHEMA_VERSION,
        seq: ++this.seq,
        at: new Date().toISOString(),
        ...input,
      };
      // Serialize once, up front: a detail object that cannot be serialized must
      // neither consume a sequence number nor reach the in-memory index.
      line = `${JSON.stringify(entry)}\n`;
    } catch (error) {
      this.noteFailure(error);
      return Promise.resolve();
    }
    this.recentRecords.push(entry);
    if (this.recentRecords.length > this.recentLimit)
      this.recentRecords.splice(
        0,
        this.recentRecords.length - this.recentLimit,
      );
    const work = this.serial
      .then(() => this.append(line))
      .catch((error) => this.noteFailure(error));
    this.serial = work;
    return work;
  }

  /** Wait for every queued append to settle. Errors are already absorbed. */
  async flush(): Promise<void> {
    await this.serial;
  }

  /** Most recent records first. */
  recent(limit = 20): RobotActionAuditRecord[] {
    const count = Number.isInteger(limit) && limit > 0 ? limit : 20;
    return this.recentRecords
      .slice(-count)
      .reverse()
      .map((record) => structuredClone(record));
  }

  status(): RobotActionAuditStatus {
    return {
      enabled: this.enabled,
      ...(this.filePath ? { filePath: this.filePath } : {}),
      records: this.recentRecords.length,
      written: this.written,
      failures: this.failures,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      bytes: this.bytes,
      maxBytes: this.maxBytes,
    };
  }

  private async append(line: string): Promise<void> {
    if (!this.filePath) return;
    const size = Buffer.byteLength(line);
    if (this.bytes > 0 && this.bytes + size > this.maxBytes)
      await this.rotate();
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, line, 'utf8');
    this.bytes += size;
    this.written++;
  }

  /** Keep exactly one previous file; an unattended bench must not fill a disk. */
  private async rotate(): Promise<void> {
    if (!this.filePath) return;
    const rotated = `${this.filePath}.1`;
    // rename() cannot replace an existing file on Windows, so clear it first.
    await rm(rotated, { force: true });
    try {
      await rename(this.filePath, rotated);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.bytes = 0;
  }

  private noteFailure(error: unknown): void {
    this.failures++;
    this.lastError = error instanceof Error ? error.message : String(error);
    try {
      this.onError?.(error);
    } catch {
      // A failing observer must not escalate either.
    }
  }
}
