import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from '@rstest/core';
import { inspectStorage } from '../src/storage/inspect.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith('robot-inspect-')
    )
      throw new Error('Unsafe cleanup path');
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'robot-inspect-'));
  directories.push(root);
  return root;
}

const profiles = {
  format: 'midscene.robot-arm.profiles',
  schemaVersion: 1,
  robots: [{ id: 'robot' }],
  tools: [{ id: 'tool', name: 'Stylus' }],
  screens: [{ id: 'screen', name: 'Phone' }],
  calibrations: [],
  sessions: [],
};

function entry(id: string, folder: string) {
  return {
    installationId: id,
    name: folder,
    adapter: 'mg400',
    adapterOptions: { host: '192.168.1.6' },
    stateDirectory: `installations/${folder}`,
    lastUsedAt: '2026-10-22T02:00:00Z',
  };
}

it('reports duplicates, missing folders, orphans and old artifacts without changing anything', async () => {
  const root = await fixture();
  await mkdir(path.join(root, 'installations', 'mg400'), { recursive: true });
  await mkdir(path.join(root, 'installations', 'orphan'), { recursive: true });
  await mkdir(path.join(root, 'backups'), { recursive: true });
  await writeFile(
    path.join(root, 'installations', 'mg400', 'profiles.json'),
    JSON.stringify(profiles),
  );
  await writeFile(path.join(root, '.storage.lock'), '{}');
  await writeFile(
    path.join(root, 'installations.json'),
    JSON.stringify({
      format: 'midscene.robot-arm.installations',
      version: 1,
      activeInstallationId: 'one',
      installations: [entry('one', 'mg400'), entry('two', 'mg400-2')],
    }),
  );
  const inspection = await inspectStorage(root);
  expect(inspection.format).toBe('midscene.robot-arm.installations');
  expect(inspection.version).toBe(1);
  expect(inspection.problem).toBeUndefined();
  expect(inspection.installations).toHaveLength(2);
  expect(inspection.installations[0]).toMatchObject({
    name: 'mg400',
    folder: 'mg400',
    duplicate: true,
    directoryExists: true,
    toolName: 'Stylus',
    screenName: 'Phone',
  });
  expect(inspection.installations[1]).toMatchObject({
    folder: 'mg400-2',
    duplicate: true,
    directoryExists: false,
  });
  expect(inspection.duplicates).toEqual([['one', 'two']]);
  expect(inspection.missingDirectories).toEqual(['two']);
  expect(inspection.unrecognizedDirectories).toEqual(['orphan']);
  expect(inspection.unrecognizedEntries).toEqual(
    expect.arrayContaining(['.storage.lock', 'backups']),
  );
  expect(inspection.oldArtifacts).toEqual(
    expect.arrayContaining(['.storage.lock', 'backups']),
  );
  expect(inspection.lock).toBeUndefined();
});

it('reports an earlier index as a problem instead of throwing', async () => {
  const root = await fixture();
  await writeFile(
    path.join(root, 'installations.json'),
    JSON.stringify({ schemaVersion: 2, installations: [] }),
  );
  const inspection = await inspectStorage(root);
  expect(inspection.problem).toContain('earlier development build');
  expect(inspection.registry).toBeUndefined();
  expect(inspection.installations).toEqual([]);
});
