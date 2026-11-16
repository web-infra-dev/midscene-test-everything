#!/usr/bin/env node
import { createInterface } from 'node:readline';
let sequence = 0;
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  const index = ++sequence;
  if (index === 4) process.exit(17);
  const result = {
    pid: process.pid,
    sequence: index,
    devices:
      index === 2 ? [] : [{ id: 'usb-a', name: 'iPhone', model: 'iOS Device' }],
    identities: [],
    authorization: 3,
  };
  const delay = index === 1 ? 30 : 0;
  setTimeout(
    () =>
      process.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`),
    delay,
  );
}
