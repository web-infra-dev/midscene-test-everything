import type { IncomingMessage, ServerResponse } from 'node:http';
export async function readJSON(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new Error('Expected application/json');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65536) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
export function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
}
