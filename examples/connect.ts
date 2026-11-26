import { loadEnvFile } from 'node:process';
import { agentOverConnectProtocol } from '@midscene/connect';

try {
  loadEnvFile(new URL('../.env', import.meta.url));
} catch (error) {
  if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
    throw error;
}

// A device URL, e.g. http://localhost:5801/devices/<id> for iOS AirLink.
const agent = await agentOverConnectProtocol({
  url: process.env.MIDSCENE_CONNECT_URL,
  token: process.env.MIDSCENE_CONNECT_TOKEN,
});

try {
  console.log(await agent.aiQuery('Summarize what is visible on the screen.'));
} finally {
  await agent.destroy();
}
