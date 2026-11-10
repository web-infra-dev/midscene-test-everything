import { writeSync } from 'node:fs';
import { createInterface } from 'node:readline';
for await (const line of createInterface({ input: process.stdin })) {
  const value = JSON.parse(line);
  if (value.frame) writeSync(3, Buffer.from(value.frame, 'base64'));
  if (value.fail) {
    process.stderr.write('AirPlay receiver failed to bind\n');
    process.exit(1);
  }
}
