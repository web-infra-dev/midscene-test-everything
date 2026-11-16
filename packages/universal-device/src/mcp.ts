import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  ServiceError,
  UniversalDevice,
  type UniversalDeviceOptions,
  type UniversalDeviceProfile,
  listUniversalDevices,
} from './client/service-client.js';
import { type InputAction, inputAction } from './input-action.js';

function resolveConnection(defaultHost?: string): UniversalDeviceOptions {
  const host = defaultHost || process.env.MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL;
  if (!host?.trim()) {
    throw new Error(
      'Set MIDSCENE_UNIVERSAL_DEVICE_SERVICE_URL or pass --host URL.',
    );
  }
  const token = process.env.MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN;
  if (!token?.trim()) {
    throw new Error('Set MIDSCENE_UNIVERSAL_DEVICE_SERVICE_TOKEN.');
  }
  return { host, token };
}

class McpDevicePool {
  private devices = new Map<string, UniversalDevice>();

  constructor(
    private defaultHost?: string,
    private defaultDeviceId?: string,
  ) {}

  private connection() {
    return resolveConnection(this.defaultHost);
  }

  async listDevices() {
    const profiles = await listUniversalDevices(this.connection());
    return profiles.map((profile) => ({
      ...profile,
      acquiredByMcp: this.isHeld(profile.id),
    }));
  }

  private isHeld(deviceId: string) {
    const held = this.devices.get(deviceId);
    return Boolean(held && !held.sessionEnded);
  }

  private async resolveTarget(
    requestedId?: string,
  ): Promise<{ deviceId: string; profile?: UniversalDeviceProfile }> {
    const explicitId =
      requestedId ||
      this.defaultDeviceId ||
      process.env.MIDSCENE_UNIVERSAL_DEVICE_ID;
    const profiles = await listUniversalDevices(this.connection());
    if (explicitId) {
      const profile = profiles.find((item) => item.id === explicitId);
      if (!profile) throw new Error(`Device not found: ${explicitId}`);
      return { deviceId: profile.id, profile };
    }
    if (profiles.length === 0) throw new Error('No devices configured.');
    if (profiles.length > 1) {
      throw new Error(
        'Multiple devices available; specify deviceId (call list_devices first).',
      );
    }
    return { deviceId: profiles[0].id, profile: profiles[0] };
  }

  private async ensureConnected(
    requestedId?: string,
  ): Promise<{ device: UniversalDevice; profile?: UniversalDeviceProfile }> {
    const connection = this.connection();
    const { deviceId, profile } = await this.resolveTarget(requestedId);
    const existing = this.devices.get(deviceId);
    if (existing && !existing.sessionEnded) {
      return { device: existing, profile };
    }
    if (existing) this.devices.delete(deviceId);

    const device = await UniversalDevice.connect({
      ...connection,
      deviceId,
      name: profile?.name,
      actions: profile?.actions,
      inputGuidance: profile?.inputGuidance,
    });
    this.devices.set(deviceId, device);
    return { device, profile };
  }

  private handleSessionError(deviceId: string, error: unknown) {
    if (error instanceof ServiceError && error.status === 410) {
      this.devices.delete(deviceId);
    }
  }

  async screenshot(requestedId?: string) {
    const { device, profile } = await this.ensureConnected(requestedId);
    const id = profile?.id ?? device.id;
    try {
      const frame = await device.screenshot();
      return { deviceId: id, frame };
    } catch (error) {
      this.handleSessionError(id, error);
      throw error;
    }
  }

  async execute(action: InputAction, requestedId?: string) {
    const { device, profile } = await this.ensureConnected(requestedId);
    const id = profile?.id ?? device.id;
    if (profile && !profile.actions.includes(action.type)) {
      throw new Error(`Device ${id} does not support ${action.type}.`);
    }
    try {
      await device.execute(action);
      return { ok: true, deviceId: id, type: action.type };
    } catch (error) {
      this.handleSessionError(id, error);
      throw error;
    }
  }

  async release(requestedId?: string) {
    if (requestedId) {
      const device = this.devices.get(requestedId);
      if (!device) return { ok: true, released: [] as string[] };
      this.devices.delete(requestedId);
      await device.destroy().catch(() => {});
      return { ok: true, released: [requestedId] };
    }
    const entries = [...this.devices.entries()];
    this.devices.clear();
    await Promise.all(entries.map(([, d]) => d.destroy().catch(() => {})));
    return { ok: true, released: entries.map(([id]) => id) };
  }
}

const mcpInstructions = `Midscene Universal Device MCP server controls physical device screens through screenshots and input actions.

Workflow:
1. Call list_devices first to inspect available device IDs, status, supported actions, and inputGuidance. Strictly follow inputGuidance if present, and only send action types listed in actions.
2. Call screenshot before choosing coordinates. Origin (0, 0) is the top-left corner in the returned width x height pixel space.
3. Call execute_action one step at a time, then wait briefly if UI transitions/animations/loads are settling and call screenshot again to verify the result. Repeat until the user's goal is achieved.
4. Call release_device when the task finishes or hits an unrecoverable blocker so the device is freed immediately.`;

export async function startMcpServer(options?: {
  host?: string;
  deviceId?: string;
}) {
  const pool = new McpDevicePool(options?.host, options?.deviceId);
  const server = new McpServer(
    {
      name: 'universal-device',
      version: '0.1.0',
    },
    {
      instructions: mcpInstructions,
    },
  );

  server.tool(
    'list_devices',
    'List available Universal Device targets, their status, supported actions, and inputGuidance.',
    {},
    async () => {
      const devices = await pool.listDevices();
      return {
        content: [{ type: 'text', text: JSON.stringify(devices, null, 2) }],
      };
    },
  );

  server.tool(
    'screenshot',
    'Capture the current screen of a device. Automatically acquires and keeps an exclusive control session alive.',
    {
      deviceId: z
        .string()
        .optional()
        .describe('Target device ID (optional when only one device exists)'),
    },
    async ({ deviceId }) => {
      const { deviceId: id, frame } = await pool.screenshot(deviceId);
      return {
        content: [
          {
            type: 'image',
            data: frame.jpeg.toString('base64'),
            mimeType: 'image/jpeg',
          },
          {
            type: 'text',
            text: JSON.stringify({
              deviceId: id,
              width: frame.width,
              height: frame.height,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    'execute_action',
    'Execute a single Universal Device input action (tap, swipe, scroll, typeText, key, etc.) on the device.',
    {
      deviceId: z
        .string()
        .optional()
        .describe('Target device ID (optional when only one device exists)'),
      action: inputAction.describe('Universal Device input action payload'),
    },
    async ({ deviceId, action }) => {
      const result = await pool.execute(action, deviceId);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.tool(
    'release_device',
    'Release the exclusive control session held by MCP for a device (or all held devices if deviceId is omitted).',
    {
      deviceId: z
        .string()
        .optional()
        .describe('Target device ID to release; omit to release all'),
    },
    async ({ deviceId }) => {
      const result = await pool.release(deviceId);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  const cleanup = async () => {
    await pool.release();
  };
  process.once('SIGINT', () => void cleanup().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void cleanup().finally(() => process.exit(0)));

  const transport = new StdioServerTransport();
  transport.onclose = () => {
    void cleanup();
  };
  await server.connect(transport);
}
