import { markerRequest } from './marker-client';
import type {
  InstallationTeaching,
  InstallationTeachingDraft,
  InstallationTeachingPoint,
  RuntimeState,
} from './robot-arm-api';
export interface TeachingBinding {
  robotProfileId: string;
  toolProfileId: string;
  screenProfileId: string;
  cameraId: string;
}
export class TeachingClient {
  constructor(
    readonly base: string,
    readonly binding: TeachingBinding,
  ) {}
  private request<T>(action: string, extra: object = {}) {
    return markerRequest<T>(`${this.base}/installation-teaching`, {
      action,
      ...extra,
    });
  }
  installationTeaching() {
    return this.request<InstallationTeaching | null>('read');
  }
  installationTeachingDraft() {
    return this.request<InstallationTeachingDraft | null>('draft');
  }
  state() {
    return this.request<RuntimeState>('state');
  }
  enterTeachingDrag(_binding: TeachingBinding) {
    return this.request<void>('enter-drag');
  }
  exitDrag() {
    return this.request<void>('exit-drag');
  }
  captureInstallationPoint(
    _binding: TeachingBinding,
    point: InstallationTeachingPoint,
  ) {
    return this.request<InstallationTeachingDraft>('capture', { point });
  }
  teachInstallation(input: {
    binding: TeachingBinding;
    draftId: string;
    corridorConfirmed: boolean;
  }) {
    return this.request<InstallationTeaching>('save', {
      draftId: input.draftId,
      corridorConfirmed: input.corridorConfirmed,
    });
  }
  gotoTeachingPosition(
    _binding: TeachingBinding,
    teachingId: string,
    point: InstallationTeachingPoint,
    stopRevision: number,
  ) {
    return this.request<void>('position', {
      point,
      teachingId,
      stopRevision,
      confirmed: true,
    });
  }
  positionInstallationPoint(
    _binding: TeachingBinding,
    point: InstallationTeachingPoint,
  ) {
    return this.request<void>('position', { point, confirmed: true });
  }
}
