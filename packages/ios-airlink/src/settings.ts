import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { styleText } from 'node:util';
import {
  ensureDeviceToken,
  readDeviceToken,
} from '@midscene/universal-device/server';

export const defaultPort = 5801;
export const label = 'com.midscene.ios-airlink';
export const directory = join(homedir(), '.midscene', 'ios-airlink', 'service');
export const tokenPath = join(directory, 'access-token');

export const readToken = () => readDeviceToken(tokenPath);
export const ensureToken = () => ensureDeviceToken(tokenPath);

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
      `✓ iOS AirLink   ${style('green', 'Running')}`,
      '',
      ...rows('🖥️', 'Manage', [`${local}/`]),
      ...rows('🌐', 'Connect', addresses),
      ...rows(
        '📚',
        'API Docs',
        addresses.map((address) => `${address}/api/docs/`),
      ),
      '',
      `  🔑  Get an access token with ${style('bold', 'ios-airlink token')}`,
    ].join('\n'),
  );
}
