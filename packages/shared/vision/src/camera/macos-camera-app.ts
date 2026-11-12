import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { type Socket, createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { JpegStreamParser } from './jpeg-stream-parser.js';
import type { CameraSource } from './types.js';

const exec = promisify(execFile);
const native = new URL('../../native/', import.meta.url);

export async function buildCameraApp(directory: string) {
  const source = new URL('macos-camera.swift', native);
  const info = await readFile(new URL('macos-camera-Info.plist', native));
  const entitlements = new URL('macos-camera-entitlements.plist', native);
  const digest = createHash('sha256')
    .update(await readFile(source))
    .update(info)
    .update(await readFile(entitlements))
    .update(process.arch)
    .digest('hex')
    .slice(0, 16);
  const app = join(directory, digest, 'Midscene Camera.app');
  const executable = 'Contents/MacOS/MidsceneCamera';
  try {
    await access(join(app, executable));
    return app;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(join(directory, digest), { recursive: true, mode: 0o700 });
  const temporary = await mkdtemp(join(directory, digest, 'build-'));
  try {
    const candidate = join(temporary, 'Midscene Camera.app');
    await mkdir(join(candidate, 'Contents/MacOS'), { recursive: true });
    await writeFile(join(candidate, 'Contents/Info.plist'), info);
    await exec(
      '/usr/bin/swiftc',
      ['-O', fileURLToPath(source), '-o', join(candidate, executable)],
      { timeout: 120_000 },
    );
    await exec(
      '/usr/bin/codesign',
      [
        '--force',
        '--sign',
        '-',
        '--options',
        'runtime',
        '--entitlements',
        fileURLToPath(entitlements),
        candidate,
      ],
      { timeout: 30_000 },
    );
    try {
      await rename(candidate, app);
    } catch (error) {
      if (
        !['EEXIST', 'ENOTEMPTY'].includes(
          (error as NodeJS.ErrnoException).code ?? '',
        )
      )
        throw error;
    }
    return app;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function cameraReady(socket: Socket, signal: AbortSignal) {
  let header = Buffer.alloc(0);
  const chunks = socket.iterator({ destroyOnReturn: false });
  const abort = () => socket.destroy();
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    for await (const chunk of chunks) {
      const bytes = Buffer.concat([header, chunk as Buffer]);
      const newline = bytes.indexOf(10);
      if (newline < 0 && bytes.length < 4096) {
        header = bytes;
        continue;
      }
      if (newline < 0 || newline > 4096)
        throw new Error('Invalid camera helper response');
      const line = bytes.subarray(0, newline).toString('utf8');
      if (line.startsWith('error ')) throw new Error(line.slice(6));
      if (line !== 'ready') throw new Error('Invalid camera helper response');
      socket.unshift(bytes.subarray(newline + 1));
      return;
    }
    signal.throwIfAborted();
    throw new Error('Camera helper closed before authorizing capture');
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

export async function openCameraApp(
  app: string,
  captureArgs: string[],
  cancellation?: AbortSignal,
): Promise<CameraSource> {
  cancellation?.throwIfAborted();
  // sockaddr_un has a short path limit. The private directory also limits
  // which local users can connect to the JPEG socket.
  const directory = await mkdtemp('/tmp/midscene-camera-');
  const path = join(directory, 'frames.sock');
  const server = createServer({ allowHalfOpen: true });
  let socket: Socket | undefined;
  let launcher: ReturnType<typeof spawn> | undefined;
  const exited = new AbortController();
  const timeoutSignal = AbortSignal.timeout(60_000);
  const readiness = cancellation
    ? AbortSignal.any([timeoutSignal, cancellation])
    : timeoutSignal;
  const signal = AbortSignal.any([readiness, exited.signal]);
  try {
    server.listen(path);
    await once(server, 'listening', { signal });
    const connected = once(server, 'connection', { signal });
    launcher = spawn(
      '/usr/bin/open',
      ['-g', '-n', '-W', '-a', app, '--args', ...captureArgs, '--socket', path],
      {
        stdio: 'ignore',
      },
    );
    launcher.once('error', (error) => exited.abort(error));
    launcher.once('exit', () =>
      exited.abort(new Error('Could not launch Midscene Camera')),
    );
    [socket] = (await connected) as [Socket];
    server.close();
    await cameraReady(socket, readiness);

    const frames = socket;
    const parser = new JpegStreamParser();
    const source = new EventEmitter() as CameraSource;
    let closing: Promise<void> | undefined;
    const closed = new Promise<void>((resolve) =>
      frames.once('close', resolve),
    );
    source.close = () => {
      closing ??= (async () => {
        frames.end();
        const timeout = setTimeout(2000, undefined, { ref: false });
        await Promise.race([closed, timeout]);
        frames.destroy();
        await rm(directory, { recursive: true, force: true });
      })();
      return closing;
    };
    frames.on('data', (chunk: Buffer) => {
      for (const frame of parser.push(chunk)) source.emit('frame', frame);
    });
    frames.on('error', (error) => {
      if (!closing) source.emit('error', error);
    });
    frames.on('end', () => {
      if (!closing) source.emit('exit', { code: null, signal: null });
    });
    return source;
  } catch (error) {
    socket?.destroy();
    server.close();
    launcher?.kill();
    await rm(directory, { recursive: true, force: true });
    cancellation?.throwIfAborted();
    if (timeoutSignal.aborted || (!socket && exited.signal.aborted))
      throw new Error(
        !socket && exited.signal.aborted
          ? 'Midscene Camera exited before capture started'
          : 'Timed out waiting for Midscene Camera. Check the macOS camera permission prompt.',
        { cause: error },
      );
    throw error;
  }
}
