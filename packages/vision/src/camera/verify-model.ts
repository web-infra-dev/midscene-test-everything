import { runConnectivityTest } from '@midscene/core';
import { ModelConfigManager } from '@midscene/shared/env';
export async function verifyCameraModel(env: unknown) {
  if (!env || typeof env !== 'object' || Array.isArray(env))
    throw new Error('Invalid model configuration');
  const input = env as Record<string, unknown>;
  const keys = [
    'MIDSCENE_MODEL_NAME',
    'MIDSCENE_MODEL_FAMILY',
    'MIDSCENE_MODEL_BASE_URL',
    'MIDSCENE_MODEL_API_KEY',
  ];
  const config: Record<string, string> = {};
  for (const key of keys) {
    const value = input[key];
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.length > 8192)
    )
      throw new Error('Invalid model configuration');
    if (typeof value === 'string') config[key] = value;
  }
  if (
    !config.MIDSCENE_MODEL_NAME?.trim() ||
    !config.MIDSCENE_MODEL_FAMILY?.trim()
  )
    throw new Error('请填写模型名称和模型系列。');
  const manager = new ModelConfigManager(config);
  return runConnectivityTest({
    defaultModelConfig: manager.getModelConfig('default'),
    planningModelConfig: manager.getModelConfig('planning'),
    insightModelConfig: manager.getModelConfig('insight'),
    locateModelConfig: manager.getModelConfig('locate'),
  });
}
