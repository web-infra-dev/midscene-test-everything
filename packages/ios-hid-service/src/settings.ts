import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { styleText } from 'node:util';

export const defaultPort = 5801;
export const label = 'com.midscene.ios-hid-service';
export const directory = join(homedir(), '.midscene', 'ios-hid', 'service');
export const tokenPath = join(directory, 'access-token');
export const logPath = join(directory, 'service.log');

export async function readToken() {
  const token = (await readFile(tokenPath, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new Error('Invalid device service access token');
  return token;
}

export async function ensureToken() {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(tokenPath, randomBytes(32).toString('hex'), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  return readToken();
}

export function printRunningService(port: number) {
  const local = `http://localhost:${port}`;
  const network = Object.values(networkInterfaces())
    .flat()
    .flatMap((entry) =>
      entry?.family === 'IPv4' && !entry.internal
        ? [`http://${entry.address}:${port}`]
        : [],
    );
  const addresses = [local, ...new Set(network)];
  const labelWidth = 10;
  const continuation = ' '.repeat(6 + labelWidth);
  const style = (format: 'bold' | 'green', value: string) =>
    process.stdout.isTTY && process.env.NO_COLOR === undefined
      ? styleText(format, value)
      : value;
  const rows = (icon: string, title: string, urls: string[]) => {
    const [first, ...rest] = urls;
    return [
      `  ${icon}  ${style('bold', title.padEnd(labelWidth))}${first}`,
      ...rest.map((url) => continuation + url),
    ];
  };

  console.log(
    [
      `✓ iOS HID Device Service   ${style('green', 'Running')}`,
      '',
      ...rows('🖥️', 'Manage', [`${local}/`]),
      ...rows('🌐', 'Connect', addresses),
      ...rows(
        '📚',
        'API Docs',
        addresses.map((address) => `${address}/api/docs/`),
      ),
      '',
      `  🔑  Get an access token with ${style('bold', 'hid-service token')}`,
    ].join('\n'),
  );
}
