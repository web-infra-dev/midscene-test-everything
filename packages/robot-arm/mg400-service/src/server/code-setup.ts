import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { RobotArmAdapter } from '@midscene/arm-kit';
import { robotConnectionKey } from '@midscene/arm-kit';
import { ProfileStore } from '@midscene/arm-kit/internal/runtime/profile-store';
import { InstallationRegistry } from '@midscene/arm-kit/internal/server/installation-registry';
import { robotDataRoot } from '@midscene/arm-kit/internal/storage/layout';
import { within } from '@midscene/arm-kit/internal/storage/layout';
import type { PlaygroundOptions } from './index.js';
import type { SessionContext, SessionInput } from './session.js';
import { PlaygroundSession } from './session.js';

export class CodeSetup extends PlaygroundSession {
  private registry?: InstallationRegistry;
  private error?: string;
  constructor(
    context: SessionContext,
    private createAdapter: PlaygroundOptions['createAdapter'],
    private installationId?: string,
    private connection?: PlaygroundOptions['connection'],
    private connectionDiagram?: PlaygroundOptions['connectionDiagram'],
    private discoverHost?: PlaygroundOptions['discoverHost'],
  ) {
    super(context);
    if (discoverHost && !connection)
      throw new TypeError(
        'Controller discovery requires a registered connection',
      );
    if (installationId && connection)
      throw new TypeError(
        'Choose an installationId or a registered connection',
      );
    if (connection) this.registry = new InstallationRegistry(process.cwd());
  }
  async initialize() {
    await this.registry?.load();
  }
  status() {
    return {
      managed: false,
      connection: this.connection,
      connectionDiagram: this.connectionDiagram,
      session: this.session,
      phase: this.phase,
      runtimeAvailable: Boolean(this.getArm()),
      error: this.error,
    };
  }
  private async storage(adapter: RobotArmAdapter) {
    if (this.registry && this.connection) {
      const current = this.registry.current();
      const same =
        current &&
        robotConnectionKey(this.connection) ===
          robotConnectionKey({
            adapter: current.adapter,
            options: current.adapterOptions,
          });
      const installation = await this.registry.used({
        adapter: this.connection.adapter,
        adapterOptions: this.connection.options,
        installationId: same ? current.installationId : randomUUID(),
      });
      return {
        key: installation.installationId,
        file: join(
          within(this.registry.directory, installation.stateDirectory),
          'profiles.json',
        ),
      };
    }
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          adapter.id,
          adapter.connectionIdentity,
          this.installationId,
        ]),
      )
      .digest('hex');
    return {
      key,
      file: join(robotDataRoot(), 'devices', key, 'profiles.json'),
    };
  }
  reconnect(input: SessionInput) {
    return this.mutate(input, async () => {
      await this.stationary({ disabled: true });
      this.session = randomUUID();
      this.phase = 'connecting';
      this.error = undefined;
      try {
        if (this.discoverHost && this.connection) {
          const host = await this.discoverHost();
          this.connection = {
            ...this.connection,
            options: { ...this.connection.options, host },
          };
        }
        const address = this.connection?.options.host;
        const host = typeof address === 'string' ? address : undefined;
        const adapter = await this.createAdapter(host);
        if (!adapter.id || !adapter.connectionIdentity)
          throw new Error('Adapter identity required');
        const { file, key } = await this.storage(adapter);
        await this.replace(adapter, new ProfileStore(file), key, host);
        this.phase = 'connected';
      } catch (error) {
        this.phase = 'error';
        this.error = error instanceof Error ? error.message : String(error);
        throw error;
      }
      return this.status();
    });
  }
}
