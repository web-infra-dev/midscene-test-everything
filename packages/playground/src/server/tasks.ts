import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RobotArmDevice } from '@midscene/arm-kit';
import type { AgentOpt } from '@midscene/core/agent';
import { Agent } from '@midscene/core/agent';
import { PlaygroundServer } from '@midscene/playground';
import { ModelConfigManager } from '@midscene/shared/env';
import type { PlaygroundDevices } from './devices.js';

// Private mounting surface of the pinned upstream server.
interface MountedServer {
  currentTaskId?: string;
  _configDirty: boolean;
  taskAbortControllers?: Record<string, AbortController>;
  close(): Promise<void>;
  initializeApp(): void;
  setActiveAgent(agent: Agent): void;
  registerReportFile(
    path: string,
  ): Promise<{ url: string; replayUrl: string } | undefined>;
  app: ((req: IncomingMessage, res: ServerResponse) => void) & {
    use(
      handler: (
        req: IncomingMessage & { path: string },
        res: ServerResponse & {
          json: (body: unknown) => unknown;
          status(code: number): unknown;
        },
        next: () => void,
      ) => void,
    ): void;
  };
}
interface TaskSummary {
  id: string;
  cameraId: string;
  name: string;
}
interface TaskEntry extends TaskSummary {
  closed?: boolean;
  cleanupError?: Error;
  closing?: Promise<boolean>;
  physicalCameraId: string;
  signature?: string;
  modelConfig?: AgentOpt['modelConfig'];
  server?: MountedServer;
}
type AgentFactory = (
  device: RobotArmDevice,
  options: AgentOpt,
) => Agent | Promise<Agent>;

/** One conversation/Agent per device; physical camera and arm remain shared. */
export class PlaygroundTasks {
  entries = new Map<string, TaskEntry & { server: MountedServer }>();
  private createAgent: AgentFactory;
  private Server: typeof PlaygroundServer;
  private Device: typeof RobotArmDevice;
  creating = new Set<Promise<TaskSummary>>();
  creatingByCamera = new Map<string, Promise<TaskSummary>>();
  closed = false;
  constructor(
    private devices: PlaygroundDevices,
    {
      createAgent = (device, options) => new Agent(device, options),
      Server = PlaygroundServer,
      Device = RobotArmDevice,
    }: {
      createAgent?: AgentFactory;
      Server?: typeof PlaygroundServer;
      Device?: typeof RobotArmDevice;
    } = {},
  ) {
    this.createAgent = createAgent;
    this.Server = Server;
    this.Device = Device;
  }
  list() {
    return [...this.entries.values()].map(
      ({ id, cameraId, name, server, closed, cleanupError }) => ({
        id,
        cameraId,
        name,
        requestId: server.currentTaskId ?? undefined,
        phase: cleanupError
          ? 'error'
          : closed
            ? 'closing'
            : server.currentTaskId
              ? 'running'
              : 'idle',
        error: cleanupError?.message,
      }),
    );
  }
  create(cameraId: string, name?: string) {
    if (this.closed) return Promise.reject(new Error('Task host is closed'));
    const existing = this.list().find((entry) => entry.cameraId === cameraId);
    if (existing) return Promise.resolve(existing);
    if (this.creatingByCamera.has(cameraId))
      return this.creatingByCamera.get(cameraId)!;
    const pending = this.createEntry(cameraId, name);
    this.creating.add(pending);
    this.creatingByCamera.set(cameraId, pending);
    void pending
      .finally(() => {
        this.creating.delete(pending);
        this.creatingByCamera.delete(cameraId);
      })
      .catch(() => undefined);
    return pending;
  }
  private async createEntry(cameraId: string, name?: string) {
    if (this.closed) throw new Error('Task host is closed');
    const source = await this.devices.open(cameraId);
    const entry: TaskEntry = {
      id: randomUUID(),
      physicalCameraId: source.cameraId,
      cameraId,
      name: name?.trim() || 'Task',
      modelConfig: undefined,
    };
    const factory = async () => {
      if (this.closed || entry.closed) throw new Error('Task is closed');
      if (entry.cleanupError) throw entry.cleanupError;
      const device = new this.Device({
        arm: this.devices.arm,
        camera: source.cameraId,
        id: cameraId,
        screenId: source.cameraId === cameraId ? undefined : cameraId,
        cameraManager: this.devices.cameras,
      });
      try {
        await device.connect();
        await device.size(); // Require an accepted, current calibration before creating an executable task.
        const agent = await this.createAgent(device, {
          generateReport: true,
          reportFileName: `arm-task-${entry.id}`,
          modelConfig: entry.modelConfig,
        });
        const destroyAgent = agent.destroy.bind(agent);
        let closing: Promise<void> | undefined;
        agent.destroy = () => {
          closing ??= (async () => {
            // Agent.destroy waits for resource idle. Cancel physical work first,
            // otherwise an in-flight move can prevent that wait from settling.
            try {
              await device.destroy();
            } catch (error) {
              entry.cleanupError =
                error instanceof Error ? error : new Error(String(error));
            }
            try {
              await destroyAgent();
            } catch (error) {
              entry.cleanupError ??=
                error instanceof Error ? error : new Error(String(error));
            }
            if (entry.cleanupError) throw entry.cleanupError;
          })();
          return closing;
        };
        return agent;
      } catch (error) {
        await device.destroy();
        throw error;
      }
    };
    const server = new this.Server(
      factory,
      undefined,
      entry.id,
    ) as unknown as MountedServer;
    entry.server = server;
    try {
      // Version-pinned mounting bridge: reuse official routes without opening one listener per task.
      // Kept here and covered by a mounted-server integration test when upgrading @midscene/playground.
      if (
        typeof server.initializeApp !== 'function' ||
        typeof server.setActiveAgent !== 'function'
      )
        throw new Error('Unsupported PlaygroundServer mounting API');
      server.setActiveAgent(await factory());
      const registerReport = server.registerReportFile.bind(server);
      server.registerReportFile = async (file) => {
        const report = await registerReport(file);
        return (
          report && {
            ...report,
            url: `/api/tasks/${entry.id}${report.url}`,
            replayUrl: `/api/tasks/${entry.id}${report.replayUrl}`,
          }
        );
      };
      server.app.use((req, res, next) => {
        if (req.method === 'POST' && req.path.startsWith('/cancel/')) {
          const json = res.json.bind(res);
          res.json = (payload) => {
            if (entry.cleanupError) {
              res.status(500);
              return json({
                error: entry.cleanupError.message,
                code: 'TASK_CLEANUP_FAILED',
              });
            }
            return json(payload);
          };
        }
        next();
      });
      server.initializeApp();
      if (this.closed) throw new Error('Task host is closed');
      this.entries.set(entry.id, Object.assign(entry, { server }));
      return { id: entry.id, cameraId, name: entry.name };
    } catch (error) {
      await server.close();
      throw error;
    }
  }
  async configure(id: string, config: NonNullable<AgentOpt['modelConfig']>) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Task not found');
    if (!config || typeof config !== 'object' || Array.isArray(config))
      throw new Error('Invalid model configuration');
    const isDefault = !Object.keys(config).length;
    const signature = isDefault
      ? undefined
      : JSON.stringify(
          Object.entries(config).sort(([a], [b]) => a.localeCompare(b)),
        );
    // Reapplying the accepted configuration on page reload is not a change.
    if (entry.signature === signature) return;
    if (entry.server.currentTaskId)
      throw new Error(
        'Wait for the running task before changing model settings',
      );
    if (!isDefault) new ModelConfigManager(config).getModelConfig('default');
    entry.modelConfig = isDefault ? undefined : structuredClone(config);
    entry.signature = signature;
    entry.server._configDirty = true;
  }
  async remove(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.closed = true;
    for (const controller of Object.values(
      entry.server.taskAbortControllers ?? {},
    )) {
      controller.abort(new Error('Task closed'));
    }
    entry.closing ??= entry.server.close().then(() => {
      if (entry.cleanupError) throw entry.cleanupError;
      return this.entries.delete(id);
    });
    await entry.closing;
  }
  abortPlanning() {
    for (const entry of this.entries.values()) {
      for (const controller of Object.values(
        entry.server.taskAbortControllers ?? {},
      )) {
        controller.abort(new Error('Arm stopped'));
      }
    }
  }
  async closeCamera(id: string) {
    await Promise.allSettled(this.creating);
    await Promise.all(
      [...this.entries.values()]
        .filter((entry) => entry.physicalCameraId === id)
        .map((entry) => this.remove(entry.id)),
    );
  }
  async close() {
    this.closed = true;
    await Promise.allSettled(this.creating);
    await Promise.all([...this.entries.keys()].map((id) => this.remove(id)));
  }
}
