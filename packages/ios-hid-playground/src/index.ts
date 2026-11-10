import { fileURLToPath } from 'node:url';
import {
  type LaunchPlaygroundOptions,
  playgroundForSessionManager,
} from '@midscene/playground';
import { DeviceWorkspaces } from './workspaces.js';
export { iosHIDPlatform } from './platform.js';
export async function launchIOSHIDPlayground(
  options: LaunchPlaygroundOptions = {},
) {
  const staticPath = fileURLToPath(new URL('./ui/', import.meta.url));
  const workspaces = new DeviceWorkspaces(staticPath);
  try {
    const launched = await playgroundForSessionManager().launch({
      staticPath,
      ...options,
      configureServer: async (server) => {
        workspaces.mount(server);
        await options.configureServer?.(server);
      },
    });
    return {
      ...launched,
      close: async () => {
        await workspaces.close();
        await launched.close();
      },
    };
  } catch (error) {
    await workspaces.close();
    throw error;
  }
}
