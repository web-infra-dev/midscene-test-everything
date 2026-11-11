import { runDaemon } from './daemon.js';
import { parsePort } from './launch-agent.js';

await runDaemon(parsePort(process.argv[2] ?? ''));
