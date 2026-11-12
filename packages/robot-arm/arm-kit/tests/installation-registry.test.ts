import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, rstest } from '@rstest/core';
import { InstallationRegistry } from '../src/server/installation-registry.js';
import { robotAuditDirectory } from '../src/storage/layout.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith('robot-registry-')
    )
      throw new Error('Unsafe cleanup path');
    await rm(directory, { recursive: true, force: true });
  }
  rstest.unstubAllEnvs();
});

async function fixture() {
  const packageRoot = await mkdtemp(path.join(tmpdir(), 'robot-registry-'));
  directories.push(packageRoot);
  rstest.stubEnv('MIDSCENE_RUN_DIR', path.join(packageRoot, 'midscene_run'));
  const root = path.join(packageRoot, '.midscene/arm-kit');
  return { packageRoot, root };
}

function profileData(installation = 'Original bench') {
  return {
    format: 'midscene.robot-arm.profiles',
    schemaVersion: 1,
    robots: [{ id: 'robot', name: 'MG400', installation }],
    tools: [{ id: 'tool', name: 'Stylus' }],
    screens: [{ id: 'screen', name: 'Phone' }],
    calibrations: [],
    sessions: [],
  };
}

async function localSource(
  packageRoot: string,
  name = 'local',
  profile = profileData(),
) {
  const directory = path.join(packageRoot, name);
  await mkdir(path.join(directory, 'logs'), { recursive: true });
  await writeFile(
    path.join(directory, 'profiles.json'),
    JSON.stringify(profile),
  );
  await writeFile(path.join(directory, 'logs/actions.jsonl'), '{"seq":1}\n');
  return directory;
}

async function seed(
  registry: InstallationRegistry,
  stateDirectory: string,
  id = 'seed-one',
  host = '192.168.1.6',
) {
  await registry.load({
    installationId: id,
    adapter: 'mg400',
    adapterOptions: { host },
    stateDirectory,
  });
}

it('initializes the first-version index and its folder map', async () => {
  const { packageRoot, root } = await fixture();
  const registry = new InstallationRegistry(packageRoot);
  await registry.load();
  const index = JSON.parse(
    await readFile(path.join(root, 'installations.json'), 'utf8'),
  );
  expect(index).toEqual({
    format: 'midscene.robot-arm.installations',
    version: 1,
    activeInstallationId: null,
    installations: [],
  });
  const entries = await readdir(root);
  expect(entries).toEqual(
    expect.arrayContaining(['README.md', 'installations.json']),
  );
  expect(entries).not.toContain('backups');
});

it('refuses an index from an earlier development build without rewriting it', async () => {
  const { packageRoot, root } = await fixture();
  await mkdir(root, { recursive: true });
  const raw = JSON.stringify({
    schemaVersion: 2,
    activeInstallationId: null,
    installations: [],
  });
  await writeFile(path.join(root, 'installations.json'), raw);
  const registry = new InstallationRegistry(packageRoot);
  await expect(registry.load()).rejects.toThrow('earlier development build');
  expect(await readFile(path.join(root, 'installations.json'), 'utf8')).toBe(
    raw,
  );
});

it('imports a machine-local configuration once and copies its known files', async () => {
  const { packageRoot, root } = await fixture();
  const source = await localSource(packageRoot);
  const registry = new InstallationRegistry(packageRoot);
  await seed(registry, source);
  const folder = path.join(root, 'installations', 'mg400');
  expect(
    JSON.parse(await readFile(path.join(folder, 'profiles.json'), 'utf8')),
  ).toMatchObject({ robots: [{ installation: 'Original bench' }] });
  expect(
    await readFile(
      path.join(robotAuditDirectory('seed-one'), 'actions.jsonl'),
      'utf8',
    ),
  ).toBe('{"seq":1}\n');
  expect(await readFile(path.join(source, 'profiles.json'), 'utf8')).toContain(
    'Original bench',
  );
  const index = JSON.parse(
    await readFile(path.join(root, 'installations.json'), 'utf8'),
  );
  expect(index.activeInstallationId).toBe('seed-one');
  expect(index.installations).toEqual([
    expect.objectContaining({
      installationId: 'seed-one',
      name: 'mg400',
      stateDirectory: 'installations/mg400',
    }),
  ]);
  const again = new InstallationRegistry(packageRoot);
  await again.load({
    installationId: 'ignored',
    adapter: 'mg400',
    adapterOptions: { host: '192.0.2.1' },
    stateDirectory: await localSource(packageRoot, 'other'),
  });
  expect(await again.list()).toHaveLength(1);
});

it('adds suffixes for duplicate models, flags the same address and renames the directory', async () => {
  const { packageRoot, root } = await fixture();
  const registry = new InstallationRegistry(packageRoot);
  await seed(registry, await localSource(packageRoot));
  const second = await registry.used({
    installationId: 'seed-two',
    adapter: 'mg400',
    adapterOptions: { host: '192.168.1.6' },
  });
  expect(second.stateDirectory).toBe('installations/mg400-2');
  const listed = await registry.list();
  expect(listed.map((item) => item.name)).toEqual(['mg400', 'mg400-2']);
  expect(listed.every((item) => item.duplicate)).toBe(true);
  await registry.rename('seed-two', 'Bench B');
  const renamed = await registry.list();
  expect(renamed.find((item) => item.installationId === 'seed-two')?.name).toBe(
    'Bench B',
  );
  const currentIndex = JSON.parse(
    await readFile(path.join(root, 'installations.json'), 'utf8'),
  );
  expect(
    currentIndex.installations.find(
      (item: { installationId: string }) => item.installationId === 'seed-two',
    ).stateDirectory,
  ).toBe('installations/bench-b');
  const previous = JSON.parse(
    await readFile(path.join(root, 'installations.json.bak'), 'utf8'),
  );
  expect(
    previous.installations.find(
      (item: { installationId: string }) => item.installationId === 'seed-two',
    ).name,
  ).toBe('mg400-2');
  expect(await readdir(path.join(root, 'installations'))).toContain('bench-b');
  await expect(
    stat(path.join(root, 'installations/mg400-2')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

it('moves configuration and backups while keeping audit history at its ID-based location', async () => {
  const { packageRoot, root } = await fixture();
  const registry = new InstallationRegistry(packageRoot);
  await seed(registry, await localSource(packageRoot));
  const original = path.join(root, 'installations/mg400');
  await writeFile(path.join(original, 'profiles.json.bak'), 'saved backup');
  await mkdir(path.join(root, 'installations/手机测试台'), { recursive: true });
  await registry.rename('seed-one', '手机测试台');
  const target = path.join(root, 'installations/手机测试台-2');
  expect(await readFile(path.join(target, 'profiles.json.bak'), 'utf8')).toBe(
    'saved backup',
  );
  expect(
    await readFile(
      path.join(robotAuditDirectory('seed-one'), 'actions.jsonl'),
      'utf8',
    ),
  ).toBe('{"seq":1}\n');
  expect(registry.current()?.stateDirectory).toBe('installations/手机测试台-2');
  const backup = JSON.parse(
    await readFile(path.join(root, 'installations.json.bak'), 'utf8'),
  );
  expect(backup.installations[0].stateDirectory).toBe(
    'installations/手机测试台-2',
  );
});

it('moves existing audit files out of configuration storage and deletes them with the installation', async () => {
  const { packageRoot, root } = await fixture();
  const registry = new InstallationRegistry(packageRoot);
  await registry.load();
  const saved = await registry.used({
    installationId: 'existing-logs',
    adapter: 'mg400',
    adapterOptions: {},
  });
  const source = path.join(root, saved.stateDirectory);
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, 'actions.jsonl'), 'current audit\n');
  await writeFile(path.join(source, 'actions.jsonl.1'), 'previous audit\n');
  await registry.load();
  const target = robotAuditDirectory('existing-logs');
  expect(await readFile(path.join(target, 'actions.jsonl'), 'utf8')).toBe(
    'current audit\n',
  );
  expect(await readFile(path.join(target, 'actions.jsonl.1'), 'utf8')).toBe(
    'previous audit\n',
  );
  expect(await readdir(source)).not.toContain('actions.jsonl');
  await registry.rename('existing-logs', 'Renamed configuration');
  expect(await readFile(path.join(target, 'actions.jsonl'), 'utf8')).toBe(
    'current audit\n',
  );
  await registry.clear();
  await registry.manage('existing-logs', 'delete');
  await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each([false, true])(
  'protects the active installation and deletes inactive storage (archived: %s)',
  async (archived) => {
    const { packageRoot, root } = await fixture();
    const registry = new InstallationRegistry(packageRoot);
    await seed(registry, await localSource(packageRoot));
    await expect(registry.manage('seed-one', 'archive')).rejects.toThrow(
      'current installation',
    );
    await expect(registry.manage('seed-one', 'delete')).rejects.toThrow(
      'current installation',
    );
    await registry.clear();
    if (archived) await registry.manage('seed-one', 'archive');
    expect(await registry.list()).toHaveLength(archived ? 0 : 1);
    await registry.manage('seed-one', 'delete');
    expect(await registry.list(true)).toHaveLength(0);
    await expect(
      stat(path.join(root, 'installations', 'mg400')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  },
);

it('reports measurements but keeps the index name instead of the profile description', async () => {
  const { packageRoot } = await fixture();
  const registry = new InstallationRegistry(packageRoot);
  await seed(
    registry,
    await localSource(packageRoot, 'local', profileData('Original bench')),
  );
  expect((await registry.list())[0]).toMatchObject({
    name: 'mg400',
    toolName: 'Stylus',
    screenName: 'Phone',
    hasConfiguration: true,
    calibrationStatus: 'missing',
  });
});

it('rejects an invalid name and reports a malformed profile without dropping it', async () => {
  const { packageRoot, root } = await fixture();
  const registry = new InstallationRegistry(packageRoot);
  await seed(registry, await localSource(packageRoot));
  await expect(registry.rename('seed-one', '   ')).rejects.toMatchObject({
    code: 'INVALID_CONFIG',
  });
  await writeFile(
    path.join(root, 'installations', 'mg400', 'profiles.json'),
    '{broken',
  );
  expect((await registry.list())[0].error).toBeTruthy();
});
