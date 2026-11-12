import type { CalibrationModelConfig } from '../model-settings';

const MODEL_ENV_KEYS = {
  MIDSCENE_ROBOT_CALIBRATION_MODEL_NAME: 'modelName',
  MIDSCENE_ROBOT_CALIBRATION_MODEL_FAMILY: 'modelFamily',
  MIDSCENE_ROBOT_CALIBRATION_MODEL_BASE_URL: 'baseUrl',
  MIDSCENE_ROBOT_CALIBRATION_MODEL_API_KEY: 'apiKey',
  MIDSCENE_MODEL_NAME: 'modelName',
  MIDSCENE_MODEL_FAMILY: 'modelFamily',
  MIDSCENE_MODEL_BASE_URL: 'baseUrl',
  MIDSCENE_MODEL_API_KEY: 'apiKey',
} as const satisfies Record<string, keyof CalibrationModelConfig>;

const LEGACY_MODEL_ENV_KEYS = {
  OPENAI_BASE_URL: 'baseUrl',
  OPENAI_API_KEY: 'apiKey',
} as const satisfies Record<string, keyof CalibrationModelConfig>;

function parseValue(rawValue: string): string {
  const value = rawValue.trim();
  const quoted = value.match(/^(['"])([\s\S]*?)\1(?:\s+#.*)?$/);
  if (quoted) return quoted[2];
  return value.replace(/\s+#.*$/, '').trim();
}

/** Parse the model variables that the playground can apply to one run. */
export function parseModelEnvironment(
  source: string,
): Partial<CalibrationModelConfig> {
  const values = new Map<string, string>();

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const assignment = trimmed.replace(/^export\s+/, '');
    const separator = assignment.indexOf('=');
    if (separator < 0) continue;

    const key = assignment.slice(0, separator).trim();
    if (!(key in MODEL_ENV_KEYS) && !(key in LEGACY_MODEL_ENV_KEYS)) continue;

    const value = parseValue(assignment.slice(separator + 1));
    if (value) values.set(key, value);
  }

  const config: Partial<CalibrationModelConfig> = {};
  for (const [key, field] of Object.entries(MODEL_ENV_KEYS)) {
    const value = values.get(key);
    if (value && !config[field]) config[field] = value;
  }

  for (const [key, field] of Object.entries(LEGACY_MODEL_ENV_KEYS)) {
    if (config[field]) continue;
    const value = values.get(key);
    if (value && !config[field]) config[field] = value;
  }

  return config;
}
