export const INSTALLATIONS_FORMAT = 'midscene.robot-arm.installations';
export const INSTALLATIONS_VERSION = 1;

/** The current selection as consumed by the runtime. */
export interface StoredRobotConnection {
  installationId: string;
  adapter: string;
  adapterOptions: Record<string, string | number>;
  stateDirectory: string;
}

/** One saved physical installation in the local index. */
export interface SavedInstallation extends StoredRobotConnection {
  name: string;
  lastUsedAt: string;
  archived?: boolean;
}

export interface StorageRegistry {
  format: typeof INSTALLATIONS_FORMAT;
  version: typeof INSTALLATIONS_VERSION;
  activeInstallationId: string | null;
  installations: SavedInstallation[];
}

export function emptyRegistry(): StorageRegistry {
  return {
    format: INSTALLATIONS_FORMAT,
    version: INSTALLATIONS_VERSION,
    activeInstallationId: null,
    installations: [],
  };
}

const INSTALLATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;
const STATE_DIRECTORY = /^installations\/[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function assertInstallationName(
  value: unknown,
): asserts value is string {
  if (typeof value !== 'string' || value.trim() !== value || !value)
    throw new Error('Installation name must be 1-80 printable characters');
  const characters = [...value];
  if (
    characters.length > 80 ||
    characters.some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f;
    })
  )
    throw new Error('Installation name must be 1-80 printable characters');
}

export function assertSavedInstallation(
  entry: any,
): asserts entry is SavedInstallation {
  if (
    !isPlainObject(entry) ||
    typeof entry.installationId !== 'string' ||
    !INSTALLATION_ID.test(entry.installationId) ||
    typeof entry.adapter !== 'string' ||
    !entry.adapter ||
    typeof entry.stateDirectory !== 'string' ||
    !STATE_DIRECTORY.test(entry.stateDirectory) ||
    !isPlainObject(entry.adapterOptions) ||
    !Object.values(entry.adapterOptions).every(
      (value) => typeof value === 'string' || typeof value === 'number',
    ) ||
    typeof entry.lastUsedAt !== 'string' ||
    !Number.isFinite(Date.parse(entry.lastUsedAt)) ||
    (entry.archived !== undefined && typeof entry.archived !== 'boolean')
  )
    throw new Error('Invalid saved installation');
  assertInstallationName(entry.name);
}

export function assertRegistry(value: any): asserts value is StorageRegistry {
  if (
    !isPlainObject(value) ||
    value.format !== INSTALLATIONS_FORMAT ||
    value.version !== INSTALLATIONS_VERSION ||
    !Array.isArray(value.installations) ||
    (value.activeInstallationId !== null &&
      typeof value.activeInstallationId !== 'string')
  )
    throw new Error('Invalid installation index');
  const ids = new Set<string>();
  const directories = new Set<string>();
  for (const entry of value.installations) {
    assertSavedInstallation(entry);
    const id = entry.installationId.toLowerCase();
    const directory = entry.stateDirectory.toLowerCase();
    if (ids.has(id) || directories.has(directory))
      throw new Error('Duplicate installation in the local index');
    ids.add(id);
    directories.add(directory);
  }
  if (
    value.activeInstallationId !== null &&
    !value.installations.some(
      (entry: SavedInstallation) =>
        entry.installationId === value.activeInstallationId && !entry.archived,
    )
  )
    throw new Error('The active installation is missing or archived');
}
