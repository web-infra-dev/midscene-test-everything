import assert from 'node:assert/strict';
import type { ConnectionState } from '@midscene/ios-hid';
import { IOSHIDAgent, IOSHIDDevice } from '@midscene/ios-hid';
import { IOSHIDSessionManager } from '../../dist/platform.js';
export const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);
export class SimulatedManager extends IOSHIDSessionManager {
  connection?: ConnectionState;
  calls: Parameters<IOSHIDDevice['execute']>[0][] = [];
  destroyed = 0;
  recoveries = 0;
  recoveryError?: string;
  testInput: Record<string, string> = {};
  testScreenError?: string;
  testAgents: IOSHIDAgent[] = [];
  frame?: Buffer;
  blockTasks = false;
  taskSignal?: AbortSignal;
  onStarted?: () => void;
  finishTask!: () => void;
  async refreshConnectionState() {
    return this.getConnectionState();
  }
  getConnectionState() {
    return this.connection ? structuredClone(this.connection) : undefined;
  }
  getSnapshot() {
    return {
      state: this.connection
        ? { ...this.connection, setupId: undefined }
        : undefined,
      source: this.testInput.source ?? 'usb',
      sourceId: this.testInput.deviceId ?? this.testInput.cameraId,
      bluetoothPeerId: this.testInput.bluetoothPeerId,
      screenError: this.testScreenError,
      refreshing: false,
    };
  }
  async createSession(input: Record<string, string> = {}) {
    this.testInput = input;
    this.connection = {
      id: input.name,
      phase: 'ready',
      device: { id: input.name, name: input.name },
    };
    const device = new IOSHIDDevice();
    device.describe = () => `Simulated ${input.name}`;
    // biome-ignore lint/complexity/useLiteralKeys: Bracket access preserves type checking for non-public test hooks.
    device['getFrame'] = async () => {
      if (this.testScreenError) throw new Error(this.testScreenError);
      return {
        jpeg: this.frame ?? png,
        width: 200,
        height: 400,
        sequence: 1,
        receivedAt: Date.now(),
      };
    };
    device.execute = async (action) => {
      this.calls.push(action);
    };
    return {
      platformId: 'ios-hid',
      displayName: input.name,
      preview: { kind: 'screenshot' as const },
      agentFactory: (
        options: Parameters<
          NonNullable<
            Awaited<ReturnType<IOSHIDSessionManager['createSession']>>
          >['agentFactory']
        >[0],
      ) => {
        const agent = new IOSHIDAgent(device, options);
        agent.aiAct = async (_prompt, settings) => {
          assert.ok(settings?.abortSignal);
          if (!this.blockTasks) return input.name;
          const signal = settings.abortSignal;
          this.taskSignal = signal;
          this.onStarted?.();
          return new Promise<string>((resolve, reject) => {
            this.finishTask = () => resolve(input.name);
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
          });
        };
        this.testAgents.push(agent);
        return agent;
      },
    };
  }
  async refreshDevice() {
    this.recoveries++;
    if (this.recoveryError) throw new Error(this.recoveryError);
    if (!this.connection) throw new Error('No saved device');
    this.connection = { ...this.connection, phase: 'ready', error: undefined };
    this.testScreenError = undefined;
    this.notifyStateChange();
  }
  async destroySession() {
    if (this.connection) this.destroyed++;
    this.connection = undefined;
    await Promise.all(
      this.testAgents.splice(0).map((agent) => agent.destroy()),
    );
  }
}
