import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  type ProfileData,
  type RobotInstallationSummary,
  calibrationAccepted,
} from '../contracts.js';
import { within } from './layout.js';
import {
  INSTALLATIONS_FORMAT,
  INSTALLATIONS_VERSION,
  type SavedInstallation,
  type StorageRegistry,
  assertRegistry,
} from './registry.js';

/** Read the measured summary for one installation without changing anything. */
export async function readInstallationSummary(
  root: string,
  entry: SavedInstallation,
): Promise<RobotInstallationSummary> {
  const summary: RobotInstallationSummary = {
    installationId: entry.installationId,
    adapter: entry.adapter,
    options: structuredClone(entry.adapterOptions),
    name: entry.name,
    lastUsedAt: entry.lastUsedAt,
    archived: Boolean(entry.archived),
    hasConfiguration: false,
    calibrationStatus: 'missing',
    ...(typeof entry.adapterOptions.host === 'string'
      ? { endpoint: entry.adapterOptions.host }
      : {}),
  };
  let data: ProfileData;
  try {
    data = JSON.parse(
      await readFile(
        path.join(within(root, entry.stateDirectory), 'profiles.json'),
        'utf8',
      ),
    );
    if (
      !data ||
      !Array.isArray(data.robots) ||
      !Array.isArray(data.tools) ||
      !Array.isArray(data.screens) ||
      !Array.isArray(data.calibrations)
    )
      throw new Error('Invalid installation profiles');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      summary.error = error instanceof Error ? error.message : String(error);
    return summary;
  }
  const binding = data.workstation;
  const tool =
    data.tools.find((item) => item.id === binding?.toolProfileId) ??
    data.tools[0];
  const screen =
    data.screens.find((item) => item.id === binding?.screenProfileId) ??
    data.screens[0];
  const calibration = data.calibrations.find(
    (item) => item.id === binding?.calibrationProfileId,
  );
  summary.hasConfiguration = Boolean(
    data.tools.length || data.screens.length || data.calibrations.length,
  );
  summary.toolName = tool?.name;
  summary.screenName = screen?.name;
  summary.calibrationStatus = !calibration
    ? 'missing'
    : calibration.geometryStatus !== 'valid'
      ? 'invalid'
      : calibrationAccepted(calibration)
        ? 'accepted'
        : 'pending';
  return summary;
}

export function connectionGroupKey(entry: SavedInstallation): string {
  const host =
    typeof entry.adapterOptions.host === 'string'
      ? entry.adapterOptions.host.trim().toLowerCase()
      : '';
  return `${entry.adapter.toLowerCase()}\u0000${host}`;
}

/** Only active installations compete for one controller address. */
export function duplicateGroups(
  entries: SavedInstallation[],
): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.archived) continue;
    const key = connectionGroupKey(entry);
    const ids = groups.get(key) ?? [];
    ids.push(entry.installationId);
    groups.set(key, ids);
  }
  return groups;
}

export interface InspectedInstallation extends RobotInstallationSummary {
  folder: string;
  stateDirectory: string;
  directoryExists: boolean;
}

export interface StorageInspection {
  root: string;
  format?: string;
  version?: number;
  problem?: string;
  registry?: StorageRegistry;
  installations: InspectedInstallation[];
  duplicates: string[][];
  missingDirectories: string[];
  unrecognizedDirectories: string[];
  unrecognizedEntries: string[];
  oldArtifacts: string[];
  lock?: { pid?: number; token?: string; stale?: boolean; error?: string };
}

const EXPECTED_ROOT = new Set([
  'README.md',
  'installations.json',
  'installations.json.bak',
  'installations',
  'storage.lock',
]);
const OLD_ARTIFACTS = [
  '.storage.lock',
  'backups',
  'connection.json',
  'logs',
  'robot-arm-profiles.json',
  'robot-arm-audit.jsonl',
];

async function names(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Read-only view used by `storage list`, `storage doctor` and the console. */
export async function inspectStorage(root: string): Promise<StorageInspection> {
  const inspection: StorageInspection = {
    root,
    installations: [],
    duplicates: [],
    missingDirectories: [],
    unrecognizedDirectories: [],
    unrecognizedEntries: [],
    oldArtifacts: [],
  };
  let raw: string | undefined;
  try {
    raw = await readFile(path.join(root, 'installations.json'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (raw !== undefined) {
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      inspection.problem = 'Invalid installation index';
    }
    if (!inspection.problem) {
      inspection.format = parsed?.format;
      inspection.version = parsed?.version;
      if (
        parsed?.format !== INSTALLATIONS_FORMAT ||
        parsed?.version !== INSTALLATIONS_VERSION
      )
        inspection.problem =
          'This data directory was created by an earlier development build. Move it aside before starting the service.';
      else {
        try {
          assertRegistry(parsed);
          inspection.registry = parsed;
        } catch (error) {
          inspection.problem =
            error instanceof Error ? error.message : String(error);
        }
      }
    }
  }
  const entries = inspection.registry?.installations ?? [];
  const groups = duplicateGroups(entries);
  const duplicateIds = new Set(
    [...groups.values()].filter((ids) => ids.length > 1).flat(),
  );
  inspection.duplicates = [...groups.values()].filter((ids) => ids.length > 1);
  inspection.installations = await Promise.all(
    entries.map(async (entry) => {
      const summary = await readInstallationSummary(root, entry);
      const directory = within(root, entry.stateDirectory);
      const directoryExists = await lstat(directory)
        .then((item) => item.isDirectory())
        .catch(() => false);
      if (!directoryExists)
        inspection.missingDirectories.push(entry.installationId);
      return {
        ...summary,
        duplicate: duplicateIds.has(entry.installationId),
        folder: path.basename(entry.stateDirectory),
        stateDirectory: entry.stateDirectory,
        directoryExists,
      };
    }),
  );
  const known = new Set(
    entries.map((entry) => path.basename(entry.stateDirectory).toLowerCase()),
  );
  inspection.unrecognizedDirectories = (
    await names(path.join(root, 'installations'))
  ).filter((name) => !known.has(name.toLowerCase()));
  inspection.unrecognizedEntries = (await names(root)).filter(
    (name) => !EXPECTED_ROOT.has(name),
  );
  inspection.oldArtifacts = OLD_ARTIFACTS.filter((name) =>
    inspection.unrecognizedEntries.includes(name),
  );
  try {
    const owner = JSON.parse(
      await readFile(path.join(root, 'storage.lock'), 'utf8'),
    );
    let stale = false;
    try {
      if (!Number.isInteger(owner.pid) || owner.pid < 1)
        throw new Error('invalid pid');
      process.kill(owner.pid, 0);
    } catch (error) {
      stale = (error as NodeJS.ErrnoException).code === 'ESRCH';
    }
    inspection.lock = {
      pid: owner.pid,
      token: owner.token,
      stale,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      inspection.lock = {
        error: error instanceof Error ? error.message : String(error),
        stale: true,
      };
  }
  return inspection;
}
