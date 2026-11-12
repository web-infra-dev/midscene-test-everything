import type {
  AssistedCalibrationAction,
  AssistedCalibrationInput,
  AssistedCalibrationSetup,
  AssistedCalibrationState,
  AssistedMappingInput,
  CalibrationCommand,
  CalibrationPhoneStatus,
  CalibrationSnapshot,
} from '@midscene/robotics-shared/contracts';
export interface CalibrationClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  /** Present for an embedded Device queue lease. */
  attemptId?: string;
  fetch?: typeof globalThis.fetch;
}
export class CalibrationRequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
  get requiresCameraCheck() {
    return (
      this.code === 'MAPPING_REQUIRED' ||
      this.code === 'VISION_BINDING_CHANGED' ||
      this.code === 'CALIBRATION_MISMATCH'
    );
  }
}
export class CalibrationClient {
  private readonly baseUrl: string;
  constructor(private readonly options: CalibrationClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
  }
  private async request<T>(path: string, body?: unknown): Promise<T> {
    const response = await (this.options.fetch ?? globalThis.fetch)(
      `${this.baseUrl}${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers:
          body === undefined
            ? undefined
            : {
                'Content-Type': 'application/json',
                ...(this.options.attemptId
                  ? { 'X-Calibration-Attempt': this.options.attemptId }
                  : {}),
              },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 180000),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw new CalibrationRequestError(
        data.error?.message ??
          data.error ??
          `Calibration request failed (${response.status})`,
        data.code,
      );
    return data as T;
  }
  subscribeCalibration(
    update: (snapshot: CalibrationSnapshot) => void,
    disconnected: () => void,
  ) {
    const source = new EventSource(
      `${this.baseUrl}/assisted-calibration/events`,
    );
    source.onmessage = (event) => update(JSON.parse(event.data));
    source.onerror = disconnected;
    return () => source.close();
  }
  async calibrationPhoneStatus(): Promise<CalibrationPhoneStatus> {
    return this.request('/assisted-calibration/phone');
  }
  async assistedCalibration(): Promise<AssistedCalibrationState | null> {
    return (
      await this.request<{
        session: AssistedCalibrationState | null;
      }>('/assisted-calibration')
    ).session;
  }
  async assistedCalibrationSetup(): Promise<AssistedCalibrationSetup> {
    return (
      await this.request<{
        setup: AssistedCalibrationSetup;
      }>('/assisted-calibration/setup')
    ).setup;
  }
  async prepareAssistedCalibration(
    input: AssistedCalibrationInput,
  ): Promise<AssistedCalibrationSetup> {
    return (
      await this.request<{
        setup: AssistedCalibrationSetup;
      }>('/assisted-calibration/setup', input)
    ).setup;
  }
  async mapAssistedCalibration(
    output?: AssistedMappingInput,
  ): Promise<AssistedCalibrationSetup> {
    return (
      await this.request<{
        setup: AssistedCalibrationSetup;
      }>('/assisted-calibration/setup/mapping', output ?? {})
    ).setup;
  }
  async createAssistedCalibration(): Promise<AssistedCalibrationState> {
    return (
      await this.request<{
        session: AssistedCalibrationState;
      }>('/assisted-calibration', {})
    ).session;
  }
  async assistedCalibrationCommand(
    id: string,
    action: AssistedCalibrationAction,
    confirmed = false,
    attemptId?: string,
  ): Promise<AssistedCalibrationState> {
    return (
      await this.request<{
        session: AssistedCalibrationState;
      }>(`/assisted-calibration/${encodeURIComponent(id)}/commands`, {
        action,
        confirmed,
        attemptId,
      })
    ).session;
  }
  async assistedCalibrationSafety(
    id: string,
    command: CalibrationCommand,
  ): Promise<AssistedCalibrationState> {
    return (
      await this.request<{
        session: AssistedCalibrationState;
      }>(`/assisted-calibration/${encodeURIComponent(id)}/safety`, command)
    ).session;
  }
}
export function createCalibrationClient(options: CalibrationClientOptions) {
  return new CalibrationClient(options);
}
