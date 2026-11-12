import { loadEnvFile } from 'node:process';
import { agentFromOpenDevice } from '@midscene/open-device';

try {
  loadEnvFile(new URL('../.env', import.meta.url));
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
    throw error;
}

const agent = await agentFromOpenDevice({
  host: process.env.OPEN_DEVICE_SERVICE_URL || 'http://localhost:5801',
  deviceId: process.env.OPEN_DEVICE_ID || undefined,
});

try {
  console.log(await agent.aiQuery('Summarize what is visible on the screen.'));
} finally {
  await agent.destroy();
}
