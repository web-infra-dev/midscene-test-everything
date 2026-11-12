import { createStore } from 'zustand';
export interface CalibrationModelConfig {
  modelName: string;
  modelFamily: string;
  baseUrl: string;
  apiKey: string;
}
export type CalibrationServerModel = Pick<
  CalibrationModelConfig,
  'modelName' | 'modelFamily'
> & { hasApiKey: boolean };
export const emptyModel = (): CalibrationModelConfig => ({
  modelName: '',
  modelFamily: '',
  baseUrl: '',
  apiKey: '',
});
/** Per-workspace memory only; credentials never enter persisted Device profiles. */
export function createCalibrationModelStore() {
  return createStore<{
    config: CalibrationModelConfig;
    custom: boolean;
    open: boolean;
  }>(() => ({ config: emptyModel(), custom: false, open: false }));
}

const detectionModelKey = 'midscene.camera-detection-model.v1';
export function loadDetectionModel():
  | { config: CalibrationModelConfig; custom: boolean }
  | undefined {
  try {
    const raw = localStorage.getItem(detectionModelKey);
    if (!raw) return undefined;
    const saved = JSON.parse(raw);
    if (
      typeof saved?.custom !== 'boolean' ||
      !saved.config ||
      !['modelName', 'modelFamily', 'baseUrl', 'apiKey'].every(
        (key) =>
          typeof saved.config[key] === 'string' &&
          saved.config[key].length <= 8192,
      )
    )
      return undefined;
    return saved;
  } catch {
    return undefined;
  }
}
export function saveDetectionModel(
  config: CalibrationModelConfig,
  custom: boolean,
): void {
  localStorage.setItem(detectionModelKey, JSON.stringify({ config, custom }));
}
export function clearDetectionModel(): void {
  localStorage.removeItem(detectionModelKey);
}
