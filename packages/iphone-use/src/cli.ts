// Compatibility entry for LaunchAgents installed by the previous version.
import { runDaemon } from './daemon.js';
import { parsePort } from './launch-agent.js';

const [command, option, port] = process.argv.slice(2);
if (command !== 'run' || option !== '--port' || !port)
  throw new Error('Use iphone-use install to start the device service');
await runDaemon(parsePort(port));
