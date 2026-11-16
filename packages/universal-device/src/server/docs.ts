import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { openAPI } from './openapi.js';

const docsPath = '/api/docs/';
const schemaPath = '/api/openapi.json';
const assets = new Map([
  ['index.html', 'text/html; charset=utf-8'],
  ['index.css', 'text/css; charset=utf-8'],
  ['swagger-ui.css', 'text/css; charset=utf-8'],
  ['swagger-ui-bundle.js', 'text/javascript; charset=utf-8'],
  ['swagger-ui-standalone-preset.js', 'text/javascript; charset=utf-8'],
  ['favicon-16x16.png', 'image/png'],
  ['favicon-32x32.png', 'image/png'],
  ['oauth2-redirect.html', 'text/html; charset=utf-8'],
  ['oauth2-redirect.js', 'text/javascript; charset=utf-8'],
]);
const assetDirectory = dirname(
  createRequire(import.meta.url).resolve('swagger-ui-dist'),
);

export function handleDeviceDocs(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): boolean {
  if (path !== schemaPath && path !== '/api/docs' && !path.startsWith(docsPath))
    return false;

  const send = (status: number, contentType: string, body: string | Buffer) => {
    if (res.destroyed) return;
    res.writeHead(status, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
  } else if (path === schemaPath) {
    res.setHeader('Cache-Control', 'no-store');
    send(200, 'application/json', JSON.stringify(openAPI));
  } else if (path === '/api/docs') {
    res.writeHead(308, { Location: docsPath });
    res.end();
  } else {
    const file = path.slice(docsPath.length) || 'index.html';
    if (file === 'swagger-initializer.js') {
      send(
        200,
        'text/javascript; charset=utf-8',
        `window.onload = () => SwaggerUIBundle({
          url: '${schemaPath}',
          dom_id: '#swagger-ui',
          validatorUrl: null,
        });`,
      );
    } else {
      const contentType = assets.get(file);
      if (!contentType) {
        send(404, 'text/plain; charset=utf-8', 'Not found');
      } else {
        void readFile(join(assetDirectory, file)).then(
          (data) => send(200, contentType, data),
          () =>
            send(
              500,
              'text/plain; charset=utf-8',
              'Swagger UI asset unavailable',
            ),
        );
      }
    }
  }
  return true;
}
