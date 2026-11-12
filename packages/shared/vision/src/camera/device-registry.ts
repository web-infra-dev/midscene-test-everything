import type {
  CameraBackend,
  CameraDevice,
  CameraSource,
  ResolvedCameraStreamOptions,
} from './types.js';

type RobotVisionLog = (message: string, ...args: unknown[]) => void;

export interface DeviceRegistryOptions {
  /** How long an enumeration stays valid. Defaults to 5 seconds. */
  ttlMs?: number;
  now?: () => number;
  logger?: RobotVisionLog;
}

export interface DeviceListResult {
  devices: CameraDevice[];
  cached: boolean;
  cachedAt?: number;
}

export interface DeviceRegistryState {
  cached: boolean;
  cachedAt?: number;
  count: number;
  hits: number;
  misses: number;
  refreshes: number;
}

export const DEFAULT_DEVICE_CACHE_TTL_MS = 5_000;

/**
 * Caches device enumeration in front of a `CameraBackend`. Concurrent callers
 * share one in-flight probe, an explicit refresh bypasses the cache, and a
 * failed probe keeps the last good result instead of wiping it.
 */
export class DeviceRegistry implements CameraBackend {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly logger?: RobotVisionLog;
  private devices?: CameraDevice[];
  private cachedAt?: number;
  private inFlight?: Promise<DeviceListResult>;
  private hits = 0;
  private misses = 0;
  private refreshes = 0;

  constructor(
    private readonly backend: CameraBackend,
    options: DeviceRegistryOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_DEVICE_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
    this.logger = options.logger;
  }

  async list(
    options: { refresh?: boolean; cachedOnly?: boolean } = {},
  ): Promise<DeviceListResult> {
    // A connected workspace must not start a fresh enumeration while capture
    // processes hold the devices; only an explicit refresh may probe again.
    if (options.cachedOnly && this.devices) {
      this.hits += 1;
      return { devices: this.devices, cached: true, cachedAt: this.cachedAt };
    }
    if (!options.refresh) {
      const cached = this.readCache();
      if (cached) {
        this.hits += 1;
        return cached;
      }
    } else {
      this.refreshes += 1;
    }

    if (this.inFlight) return this.inFlight;

    this.misses += 1;
    const probe = this.enumerate();
    this.inFlight = probe;
    try {
      return await probe;
    } finally {
      this.inFlight = undefined;
    }
  }

  listDevices(
    options: { refresh?: boolean; cachedOnly?: boolean } = {},
  ): Promise<CameraDevice[]> {
    return this.list(options).then((result) => result.devices);
  }

  openStream(options: ResolvedCameraStreamOptions): Promise<CameraSource> {
    return this.backend.openStream(options);
  }

  invalidate(): void {
    this.devices = undefined;
    this.cachedAt = undefined;
  }

  getState(): DeviceRegistryState {
    return {
      cached: this.devices !== undefined,
      cachedAt: this.cachedAt,
      count: this.devices?.length ?? 0,
      hits: this.hits,
      misses: this.misses,
      refreshes: this.refreshes,
    };
  }

  private readCache(): DeviceListResult | undefined {
    if (!this.devices || this.cachedAt === undefined) return undefined;
    if (this.now() - this.cachedAt > this.ttlMs) return undefined;
    return { devices: this.devices, cached: true, cachedAt: this.cachedAt };
  }

  private async enumerate(): Promise<DeviceListResult> {
    const devices = await this.backend.listDevices();
    this.devices = devices;
    this.cachedAt = this.now();
    this.logger?.('Enumerated camera devices', { count: devices.length });
    return { devices, cached: false, cachedAt: this.cachedAt };
  }
}
