import { loadEnvFile } from 'node:process';
import { agentFromIOSHID } from '@midscene/ios-hid';

try {
  loadEnvFile(new URL('../../.env', import.meta.url));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

const agent = await agentFromIOSHID({
  host: process.env.IOS_HID_SERVICE_URL || 'http://localhost:5801',
  deviceId: process.env.IOS_HID_DEVICE_ID || undefined,
});

try {
  await agent.aiAct('Open Settings and stay on the main screen.');
} finally {
  await agent.destroy();
}
