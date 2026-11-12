import { constants } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import { RobotArmError, type RobotInstallationSummary } from '../contracts.js';
import {
  duplicateGroups,
  readInstallationSummary,
} from '../storage/inspect.js';
import {
  atomicJson,
  atomicJsonWithBackup,
  installationDirectory,
  installationFolder,
  robotAuditDirectory,
  robotDataRoot,
  verifyRemoval,
  within,
} from '../storage/layout.js';
import { writeStorageDocs } from '../storage/readme.js';
import {
  INSTALLATIONS_FORMAT,
  INSTALLATIONS_VERSION,
  type SavedInstallation,
  type StorageRegistry,
  type StoredRobotConnection,
  assertInstallationName,
  assertRegistry,
  emptyRegistry,
} from '../storage/registry.js';

/** Known files copied from a machine-local adapter configuration on first use. */
const SEED_FILES: ReadonlyArray<readonly [string, string]> = [
  ['profiles.json', 'profiles.json'],
  ['robot-arm-profiles.json', 'profiles.json'],
];
const AUDIT_FILES: ReadonlyArray<readonly [string, string]> = [
  ['actions.jsonl', 'actions.jsonl'],
  ['actions.jsonl.1', 'actions.jsonl.1'],
  ['robot-arm-audit.jsonl', 'actions.jsonl'],
  ['robot-arm-audit.jsonl.1', 'actions.jsonl.1'],
  ['logs/actions.jsonl', 'actions.jsonl'],
  ['logs/actions.jsonl.1', 'actions.jsonl.1'],
];

const INVALID_INDEX =
  'This data directory was created by an earlier development build. Move it aside before starting the service.';

function calibrationRank(
  status: RobotInstallationSummary['calibrationStatus'],
): number {
  return status === 'accepted'
    ? 3
    : status === 'pending'
      ? 2
      : status === 'invalid'
        ? 1
        : 0;
}

/** The registry owns the active selection; callers select IDs, never paths. */
export class InstallationRegistry {
  readonly directory: string;
  private readonly file: string;
  private data?: StorageRegistry;
  constructor(packageRoot: string) {
    this.directory = robotDataRoot(packageRoot);
    this.file = path.join(this.directory, 'installations.json');
  }
  async load(
    seed?: StoredRobotConnection | (() => StoredRobotConnection | undefined),
  ): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    let raw: string | undefined;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (raw !== undefined) {
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new RobotArmError('INVALID_STORAGE', INVALID_INDEX, 500);
      }
      if (
        parsed?.format !== INSTALLATIONS_FORMAT ||
        parsed?.version !== INSTALLATIONS_VERSION
      )
        throw new RobotArmError('INVALID_STORAGE', INVALID_INDEX, 500);
      assertRegistry(parsed);
      this.data = parsed;
    } else {
      this.data = emptyRegistry();
    }
    const removedSimulator = await this.removeRetiredSimulators();
    let changed = raw === undefined;
    if (!removedSimulator && this.data.installations.length === 0) {
      const connection = typeof seed === 'function' ? seed() : seed;
      if (connection) {
        await this.seed(connection);
        changed = true;
      }
    }
    if (changed) await this.persist(this.snapshot());
    else await writeStorageDocs(this.directory);
    for (const entry of this.snapshot().installations)
      await this.moveAuditFiles(entry);
  }
  private async moveAuditFiles(entry: SavedInstallation): Promise<void> {
    const source = within(this.directory, entry.stateDirectory);
    const destination = robotAuditDirectory(entry.installationId);
    for (const [from, to] of AUDIT_FILES) {
      const file = within(source, from);
      let content: Buffer;
      try {
        content = await readFile(file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      await verifyRemoval(this.directory, source);
      await verifyRemoval(source, file);
      await mkdir(destination, { recursive: true });
      await verifyRemoval(path.dirname(destination), destination);
      const target = within(destination, to);
      await verifyRemoval(destination, target);
      try {
        await copyFile(file, target, constants.COPYFILE_EXCL);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (!(await readFile(target)).equals(content))
          throw new Error(
            `Audit log already exists at ${target}; the original was preserved at ${file}`,
          );
      }
      await rm(file);
    }
  }
  /** Retired virtual installations must not remain selectable or recoverable. */
  private async removeRetiredSimulators(): Promise<boolean> {
    const current = this.snapshot();
    let backup: StorageRegistry | undefined;
    try {
      backup = JSON.parse(await readFile(`${this.file}.bak`, 'utf8'));
      assertRegistry(backup);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const retired = (entry: SavedInstallation) =>
      /^simulator(?:-\d+)?$/.test(entry.adapter);
    const registries = [current, ...(backup ? [backup] : [])];
    const removed = registries.flatMap((data) =>
      data.installations.filter(retired),
    );
    if (!removed.length) return false;
    const retainedDirectories = new Set(
      registries.flatMap((data) =>
        data.installations
          .filter((entry) => !retired(entry))
          .map((entry) => entry.stateDirectory.toLowerCase()),
      ),
    );
    for (const directory of new Set(
      removed.map((entry) => entry.stateDirectory),
    )) {
      if (retainedDirectories.has(directory.toLowerCase()))
        throw new Error(
          'Retired simulator storage overlaps a hardware installation',
        );
      const target = within(this.directory, directory);
      await verifyRemoval(this.directory, target);
      await rm(target, { recursive: true, force: true });
    }
    for (const data of registries) {
      data.installations = data.installations.filter(
        (entry) => !retired(entry),
      );
      if (
        !data.installations.some(
          (entry) => entry.installationId === data.activeInstallationId,
        )
      )
        data.activeInstallationId = null;
    }
    // Do not back up the index being retired: that would restore virtual entries.
    if (backup) await atomicJson(`${this.file}.bak`, backup);
    await atomicJson(this.file, current);
    return true;
  }
  current(): StoredRobotConnection | undefined {
    const id = this.snapshot().activeInstallationId;
    return id ? this.get(id) : undefined;
  }
  get(id: string): StoredRobotConnection {
    const entry = this.snapshot().installations.find(
      (item) => item.installationId === id,
    );
    if (!entry || entry.archived)
      throw new Error('Unknown or archived installation');
    return {
      installationId: id,
      adapter: entry.adapter,
      adapterOptions: structuredClone(entry.adapterOptions),
      stateDirectory: entry.stateDirectory,
    };
  }
  async used(
    connection: Omit<StoredRobotConnection, 'stateDirectory'>,
    name?: string,
  ): Promise<StoredRobotConnection> {
    if (name !== undefined) assertInstallationName(name);
    const next = structuredClone(this.snapshot());
    const index = next.installations.findIndex(
      (item) => item.installationId === connection.installationId,
    );
    const current = index >= 0 ? next.installations[index] : undefined;
    if (current?.archived)
      throw new Error('Restore the archived installation before using it');
    if (current && current.adapter !== connection.adapter)
      throw new RobotArmError(
        'INSTALLATION_MISMATCH',
        'The saved installation uses a different robot model',
        409,
      );
    let entry: SavedInstallation;
    if (current) {
      entry = {
        ...current,
        adapterOptions: structuredClone(connection.adapterOptions),
        lastUsedAt: new Date().toISOString(),
      };
    } else {
      const folder = installationFolder(
        name ?? connection.adapter,
        await this.takenFolders(next),
      );
      entry = {
        installationId: connection.installationId,
        name: name ?? folder,
        adapter: connection.adapter,
        adapterOptions: structuredClone(connection.adapterOptions),
        stateDirectory: installationDirectory(folder),
        lastUsedAt: new Date().toISOString(),
      };
    }
    if (index >= 0) next.installations[index] = entry;
    else next.installations.push(entry);
    next.activeInstallationId = entry.installationId;
    await this.persist(next);
    return {
      installationId: entry.installationId,
      adapter: entry.adapter,
      adapterOptions: structuredClone(entry.adapterOptions),
      stateDirectory: entry.stateDirectory,
    };
  }
  async clear(): Promise<void> {
    await this.persist({ ...this.snapshot(), activeInstallationId: null });
  }
  async rename(
    id: string,
    name: string,
    relocate?: (
      from: string,
      to: string,
      move: () => Promise<void>,
    ) => Promise<void>,
  ): Promise<RobotInstallationSummary> {
    const normalized = typeof name === 'string' ? name.trim() : name;
    try {
      assertInstallationName(normalized);
    } catch (error) {
      throw new RobotArmError(
        'INVALID_CONFIG',
        error instanceof Error ? error.message : String(error),
        400,
      );
    }
    const next = structuredClone(this.snapshot());
    const entry = next.installations.find((item) => item.installationId === id);
    if (!entry)
      throw new RobotArmError('NOT_FOUND', 'Unknown installation', 404);
    const oldDirectory = entry.stateDirectory;
    const folder = installationFolder(
      normalized,
      (await this.takenFolders(next)).filter(
        (item) =>
          item.toLowerCase() !== path.basename(oldDirectory).toLowerCase(),
      ),
    );
    const newDirectory = installationDirectory(folder);
    const from = within(this.directory, oldDirectory);
    const to = within(this.directory, newDirectory);
    await verifyRemoval(this.directory, from);
    const move = async () => {
      const changed = oldDirectory !== newDirectory;
      if (changed) {
        await mkdir(from, { recursive: true });
        await rename(from, to);
      }
      entry.name = normalized;
      entry.stateDirectory = newDirectory;
      try {
        await this.persist(next);
      } catch (error) {
        if (changed) await rename(to, from);
        throw error;
      }
    };
    if (relocate) await relocate(from, to, move);
    else await move();
    // The previous index still describes the previous name, but its files moved too.
    const previous = JSON.parse(await readFile(`${this.file}.bak`, 'utf8'));
    assertRegistry(previous);
    const oldEntry = previous.installations.find(
      (item) => item.installationId === id,
    );
    if (oldEntry) {
      oldEntry.stateDirectory = newDirectory;
      await atomicJson(`${this.file}.bak`, previous);
    }
    return this.summary(id);
  }
  async manage(
    id: string,
    action: 'archive' | 'restore' | 'delete',
  ): Promise<void> {
    const next = structuredClone(this.snapshot());
    const entry = next.installations.find((item) => item.installationId === id);
    if (!entry) throw new Error('Unknown saved installation');
    if (id === next.activeInstallationId)
      throw new Error('The current installation cannot be archived or deleted');
    if (action === 'delete') {
      next.installations = next.installations.filter(
        (item) => item.installationId !== id,
      );
      await this.persist(next);
      const target = within(this.directory, entry.stateDirectory);
      await verifyRemoval(this.directory, target);
      await rm(target, { recursive: true, force: true });
      const auditDirectory = robotAuditDirectory(id);
      await verifyRemoval(path.dirname(auditDirectory), auditDirectory);
      await rm(auditDirectory, { recursive: true, force: true });
    } else {
      entry.archived = action === 'archive';
      await this.persist(next);
    }
  }
  async list(includeArchived = false): Promise<RobotInstallationSummary[]> {
    const entries = this.snapshot().installations.filter(
      (item) => includeArchived || !item.archived,
    );
    const duplicateIds = new Set(
      [...duplicateGroups(this.snapshot().installations).values()]
        .filter((ids) => ids.length > 1)
        .flat(),
    );
    const result = await Promise.all(
      entries.map(async (entry) => {
        const summary = await readInstallationSummary(this.directory, entry);
        summary.duplicate = duplicateIds.has(entry.installationId);
        return summary;
      }),
    );
    return result.sort(
      (a, b) =>
        Number(b.hasConfiguration) - Number(a.hasConfiguration) ||
        calibrationRank(b.calibrationStatus) -
          calibrationRank(a.calibrationStatus) ||
        b.lastUsedAt.localeCompare(a.lastUsedAt) ||
        a.installationId.localeCompare(b.installationId),
    );
  }
  async summary(id: string): Promise<RobotInstallationSummary> {
    const entry = this.snapshot().installations.find(
      (item) => item.installationId === id,
    );
    if (!entry)
      throw new RobotArmError('NOT_FOUND', 'Unknown installation', 404);
    const summary = await readInstallationSummary(this.directory, entry);
    summary.duplicate = [
      ...duplicateGroups(this.snapshot().installations).values(),
    ].some((ids) => ids.length > 1 && ids.includes(id));
    return summary;
  }
  private async seed(connection: StoredRobotConnection): Promise<void> {
    const next = this.snapshot();
    const folder = installationFolder(
      connection.adapter,
      await this.takenFolders(next),
    );
    const stateDirectory = installationDirectory(folder);
    const directory = within(this.directory, stateDirectory);
    await mkdir(directory, { recursive: true });
    const source = path.resolve(connection.stateDirectory);
    if (source !== path.resolve(directory)) {
      const copies = [
        ...SEED_FILES.map(
          ([from, to]) => [from, path.join(directory, to)] as const,
        ),
        ...AUDIT_FILES.map(
          ([from, to]) =>
            [
              from,
              path.join(robotAuditDirectory(connection.installationId), to),
            ] as const,
        ),
      ];
      for (const [from, to] of copies) {
        try {
          await mkdir(path.dirname(to), { recursive: true });
          await copyFile(path.join(source, from), to, constants.COPYFILE_EXCL);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || code === 'EEXIST') continue;
          throw error;
        }
      }
    }
    next.installations.push({
      installationId: connection.installationId,
      name: folder,
      adapter: connection.adapter,
      adapterOptions: structuredClone(connection.adapterOptions),
      stateDirectory,
      lastUsedAt: new Date().toISOString(),
    });
    next.activeInstallationId = connection.installationId;
  }
  private async takenFolders(
    next: StorageRegistry = this.snapshot(),
  ): Promise<string[]> {
    const names = new Set(
      next.installations.map((entry) => path.basename(entry.stateDirectory)),
    );
    try {
      for (const name of await readdir(
        path.join(this.directory, 'installations'),
      ))
        names.add(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return [...names];
  }
  private snapshot(): StorageRegistry {
    if (!this.data) throw new Error('Installation registry is unavailable');
    return this.data;
  }
  private async persist(next: StorageRegistry): Promise<void> {
    assertRegistry(next);
    await mkdir(this.directory, { recursive: true });
    await atomicJsonWithBackup(this.file, next);
    this.data = next;
    await writeStorageDocs(this.directory);
  }
}
