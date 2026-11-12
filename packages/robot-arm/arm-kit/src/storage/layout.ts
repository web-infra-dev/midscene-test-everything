import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RESERVED_FOLDER = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const FOLDER_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;

export function robotArmPackageRoot(): string {
  let directory = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const manifest = path.join(directory, 'package.json');
    if (
      existsSync(manifest) &&
      JSON.parse(readFileSync(manifest, 'utf8')).name === '@midscene/arm-kit'
    )
      return directory;
    const parent = path.dirname(directory);
    if (parent === directory)
      throw new Error('Cannot resolve the Robot Arm package directory');
    directory = parent;
  }
}

export function robotDataRoot(packageRoot = process.cwd()): string {
  return path.resolve(
    packageRoot,
    process.env.MIDSCENE_ARM_DATA_DIR || '.midscene/arm-kit',
  );
}

/** Audit history follows an installation ID, independently of its display name. */
export function robotAuditDirectory(installationId = 'standalone'): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(installationId))
    throw new Error('Invalid installation ID for audit storage');
  let root = robotArmPackageRoot();
  for (let directory = root; ; directory = path.dirname(directory)) {
    if (existsSync(path.join(directory, 'pnpm-workspace.yaml'))) {
      root = directory;
      break;
    }
    if (path.dirname(directory) === directory) break;
  }
  const run = process.env.MIDSCENE_RUN_DIR
    ? path.resolve(process.cwd(), process.env.MIDSCENE_RUN_DIR)
    : path.join(root, 'midscene_run');
  return within(path.join(run, 'log', 'robot-arm'), installationId);
}

export function within(root: string, relative: string): string {
  const result = path.resolve(root, relative);
  const child = path.relative(path.resolve(root), result);
  if (
    !child ||
    child === '..' ||
    child.startsWith(`..${path.sep}`) ||
    path.isAbsolute(child)
  )
    throw new Error(`Storage path escapes its parent: ${relative}`);
  return result;
}

/** Directory names stay short and readable: the robot model plus a suffix. */
export function folderSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)
    .replace(/-+$/g, '');
}

export function installationFolder(
  adapter: string,
  taken: Iterable<string> = [],
): string {
  const slug = folderSlug(adapter) || 'robot';
  const base = RESERVED_FOLDER.test(slug) ? `robot-${slug}` : slug;
  const used = new Set([...taken].map((name) => name.toLowerCase()));
  let candidate = base;
  for (let suffix = 2; used.has(candidate.toLowerCase()); suffix++)
    candidate = `${base}-${suffix}`;
  installationDirectory(candidate);
  return candidate;
}

export function installationDirectory(folder: string): string {
  if (
    !FOLDER_PATTERN.test(folder) ||
    RESERVED_FOLDER.test(folder) ||
    folder.includes('..')
  )
    throw new Error('Invalid installation folder');
  return `installations/${folder}`;
}

export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** Keep exactly one previous version next to the file. */
export async function backupPreviousFile(file: string): Promise<void> {
  try {
    await copyFile(file, `${file}.bak`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function atomicJsonWithBackup(
  file: string,
  value: unknown,
): Promise<void> {
  await backupPreviousFile(file);
  await atomicJson(file, value);
}

export async function verifyRemoval(
  root: string,
  target: string,
): Promise<void> {
  within(root, path.relative(root, target));
  try {
    if ((await lstat(target)).isSymbolicLink())
      throw new Error('Refusing to remove a linked installation');
    const resolvedRoot = await realpath(root);
    within(resolvedRoot, path.relative(resolvedRoot, await realpath(target)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
