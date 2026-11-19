import type {
  CalibrationBatchCommand,
  CalibrationBatchPlan,
  CalibrationBatchSamplingMode,
  CalibrationBatchState,
  WorkstationScreenState,
} from '@midscene/robotics-shared/assisted-contracts';
import { markerRequest } from './marker-client';
export class BatchClient {
  constructor(readonly cameraId: string) {}
  private async request<T>(
    action: string,
    input: object = {},
    signal?: AbortSignal,
  ): Promise<T> {
    return markerRequest<T>(
      '/api/calibration-batch',
      {
        action,
        cameraId: this.cameraId,
        ...input,
      },
      signal,
    );
  }
  calibrationBatch(signal?: AbortSignal) {
    return this.request<CalibrationBatchState | null>('read', {}, signal);
  }
  calibrationBatchPlan(cameraId: string) {
    return this.request<CalibrationBatchPlan>('plan', { cameraId });
  }
  screens(signal?: AbortSignal) {
    return this.request<WorkstationScreenState[]>('screens', {}, signal);
  }
  startCalibrationBatch(input: {
    cameraId: string;
    planVersion: string;
    auto: true;
    horizontalConfirmed: true;
    compliantSetupConfirmed?: true;
    samplingMode?: CalibrationBatchSamplingMode;
    acceptance?: 'manual';
    corridorConfirmed?: true;
  }) {
    return this.request<CalibrationBatchState>('start', input);
  }
  calibrationBatchCommand(id: string, command: CalibrationBatchCommand) {
    return this.request<CalibrationBatchState>('command', {
      id,
      command: command.action,
      revision: command.revision,
    });
  }
  clearCalibrationBatches() {
    return this.request<void>('clear');
  }
  deleteCalibration(calibrationProfileId: string) {
    return this.request<void>('delete-calibration', { calibrationProfileId });
  }
}
