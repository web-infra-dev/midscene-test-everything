#!/usr/bin/env node
import { createInterface } from 'node:readline';
let hosts = [];
const status = () => ({
  serviceName: 'Midscene',
  state: 'advertising as Midscene',
  hosts,
});
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.method === 'simulate') {
    hosts = request.hosts;
    process.stdout.write(
      `${JSON.stringify({ event: 'bluetooth-status', result: status() })}\n`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({ id: request.id, result: status() })}\n`,
  );
}
