import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from '@rstest/core';

const execute = promisify(execFile);
test.skipIf(process.platform !== 'darwin')(
  'native classic HID packets match the descriptor and reject unsupported boot mode',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'classic-hid-protocol-'));
    try {
      const executable = join(directory, 'protocol');
      await execute('/usr/bin/xcrun', [
        'clang',
        '-std=c11',
        '-Wall',
        '-Wextra',
        '-Werror',
        fileURLToPath(
          new URL('./fixtures/classic-protocol.c', import.meta.url),
        ),
        '-o',
        executable,
      ]);
      await execute(executable);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
