import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { directory as configDirectory } from '../../settings.js';

const execute = promisify(execFile);
const compiling = new Map<string, Promise<string>>();
export function nativeHelper(
  name: 'usb-capture' | 'hid' | 'airplay-launcher',
): Promise<string> {
  if (process.platform !== 'darwin')
    return Promise.reject(new Error('iOS AirLink requires macOS'));
  let result = compiling.get(name);
  if (!result) {
    result = compile(name).catch((error) => {
      compiling.delete(name);
      throw error;
    });
    compiling.set(name, result);
  }
  return result;
}
async function compile(name: string) {
  const source = new URL(
    `../../../native/${name}.${name === 'hid' ? 'm' : name === 'airplay-launcher' ? 'c' : 'swift'}`,
    import.meta.url,
  );
  const plist = new URL('../../../native/helper.plist', import.meta.url);
  const sources =
    name === 'airplay-launcher'
      ? [source]
      : name === 'hid'
        ? [
            source,
            new URL('../../../native/HIDDescriptor.h', import.meta.url),
            new URL('../../../native/HIDProtocol.h', import.meta.url),
          ]
        : [
            source,
            new URL('../../../native/USBIdentity.swift', import.meta.url),
            new URL('../../../native/USBDiscovery.swift', import.meta.url),
          ];
  const hash = createHash('sha256')
    .update(await readFile(plist))
    .update(process.arch);
  for (const file of sources) hash.update(await readFile(file));
  const digest = hash.digest('hex').slice(0, 20);
  const directory = join(configDirectory, 'native');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, `${name}-${digest}`);
  try {
    await access(target);
    return target;
  } catch {}
  const candidate = `${target}-${randomUUID()}`;
  try {
    await execute(
      '/usr/bin/xcrun',
      [
        ...(name === 'airplay-launcher'
          ? ['clang', '-O2', '-Wall', '-Wextra', fileURLToPath(source)]
          : name === 'hid'
            ? [
                'clang',
                '-fobjc-arc',
                '-O2',
                '-Wall',
                '-Wextra',
                '-framework',
                'Foundation',
                '-framework',
                'CoreBluetooth',
                '-framework',
                'IOBluetooth',
                fileURLToPath(source),
              ]
            : [
                'swiftc',
                '-parse-as-library',
                '-O',
                ...sources.map((file) => fileURLToPath(file)),
              ]),
        '-o',
        candidate,
        '-Xlinker',
        '-sectcreate',
        '-Xlinker',
        '__TEXT',
        '-Xlinker',
        '__info_plist',
        '-Xlinker',
        fileURLToPath(plist),
      ],
      { timeout: 120_000, maxBuffer: 2_000_000 },
    );
    await rename(candidate, target);
    return target;
  } finally {
    await rm(candidate, { force: true });
  }
}
