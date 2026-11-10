import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AssistedCalibrationAction } from '../assisted-contracts.js';
import type { CalibrationWorkflow } from '../calibration/workflow.js';
import { RobotArmError } from '../contracts.js';

/** Shared control routes. Hosts provide authentication/origin checks before invoking this handler. */
export function createCalibrationHandler(options: {
  service: CalibrationWorkflow;
  basePath?: string;
}) {
  const base = (options.basePath ?? '/api/calibration').replace(/\/+$/, '');
  const service = options.service;
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    assertWrite?: () => void,
  ): Promise<boolean> => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (!path.startsWith(`${base}/assisted-calibration`)) return false;
    const relative = path.slice(base.length);
    const send = (status: number, value: unknown) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.method === 'GET') {
        if (relative === '/assisted-calibration')
          send(200, { session: service.status() });
        else if (relative === '/assisted-calibration/phone')
          send(200, service.phoneStatus());
        else if (relative === '/assisted-calibration/setup')
          send(200, { setup: service.setup() });
        else send(404, { error: '404 Not Found' });
        return true;
      }
      if (req.method !== 'POST') {
        send(405, { error: 'Method not allowed' });
        return true;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 65536)
          throw new RobotArmError(
            'INVALID_REQUEST',
            'Calibration request is too large',
            413,
          );
        chunks.push(bytes);
      }
      let input;
      try {
        input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        throw new RobotArmError(
          'INVALID_REQUEST',
          'Expected JSON request body',
          400,
        );
      }
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new RobotArmError(
          'INVALID_REQUEST',
          'Expected a JSON object',
          400,
        );
      assertWrite?.();
      if (relative === '/assisted-calibration')
        send(200, { session: await service.create() });
      else if (relative === '/assisted-calibration/setup')
        send(200, { setup: await service.prepare(input) });
      else if (relative === '/assisted-calibration/setup/mapping') {
        // An empty POST confirms the output already prepared for this screen.
        const output = Object.keys(input).length ? input : undefined;
        send(200, { setup: await service.mapSetup(output) });
      } else {
        const match =
          /^\/assisted-calibration\/([^/]+)\/(commands|safety)$/.exec(relative);
        if (!match) {
          send(404, { error: '404 Not Found' });
          return true;
        }
        const id = decodeURIComponent(match[1]);
        if (match[2] === 'safety')
          send(200, { session: await service.calibrationCommand(id, input) });
        else {
          if (
            typeof input.action !== 'string' ||
            (input.confirmed !== undefined &&
              typeof input.confirmed !== 'boolean')
          )
            throw new RobotArmError(
              'INVALID_REQUEST',
              'Invalid calibration command',
              400,
            );
          send(200, {
            session: await service.command(
              id,
              input.action as AssistedCalibrationAction,
              input.confirmed === true,
              input.attemptId,
            ),
          });
        }
      }
    } catch (error) {
      send(error instanceof RobotArmError ? error.status : 500, {
        error: error instanceof Error ? error.message : String(error),
        code:
          error instanceof RobotArmError ? error.code : 'CALIBRATION_FAILED',
      });
    }
    return true;
  };
}
