import type { InputAction } from './input-action.js';

export type { InputAction } from './input-action.js';

export type Point = { x: number; y: number };
export interface ScreenFrame {
  jpeg: Buffer;
  width: number;
  height: number;
  sequence: number;
  receivedAt: number;
}
export type DeviceProfile = {
  id: string;
  name: string;
  status: 'available' | 'busy' | 'offline';
  screenSource?: 'usb' | 'camera' | 'airplay';
  actions: InputAction['type'][];
  preview?: 'mjpeg';
  inputGuidance?: string;
};
export type PreviewReader = {
  getFrame(): Promise<Pick<ScreenFrame, 'jpeg' | 'sequence'> | undefined>;
  close(): Promise<void>;
};
