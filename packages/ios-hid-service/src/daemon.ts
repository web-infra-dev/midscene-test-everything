import { runServer } from './server.js';

export async function runDaemon(port: number) {
  const server = await runServer(port);
  let stopping = false;
  const close = () => {
    if (stopping) return;
    stopping = true;
    void server.close().catch((error: Error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}
