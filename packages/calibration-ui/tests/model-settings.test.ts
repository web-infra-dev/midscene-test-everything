import { afterEach, expect, it } from '@rstest/core';
import {
  clearDetectionModel,
  loadDetectionModel,
  saveDetectionModel,
} from '../src/model-settings';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
const config = {
  modelName: 'test-model',
  modelFamily: 'test-family',
  baseUrl: 'https://example.test',
  apiKey: 'test-only-key',
};
it('restores all model settings after leaving and clears the saved credential explicitly', () => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
      removeItem: (key: string) => data.delete(key),
    },
  });
  expect(loadDetectionModel()).toBeUndefined();
  saveDetectionModel(config, true);
  expect(loadDetectionModel()).toEqual({ config, custom: true });
  saveDetectionModel(config, false);
  expect(loadDetectionModel()?.custom).toBe(false);
  clearDetectionModel();
  expect(data.size).toBe(0);
  expect(loadDetectionModel()).toBeUndefined();
});
it('ignores corrupted browser settings without crashing calibration', () => {
  for (const raw of [
    '{',
    '{}',
    JSON.stringify({ custom: true, config: { ...config, apiKey: null } }),
  ]) {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { getItem: () => raw },
    });
    expect(loadDetectionModel()).toBeUndefined();
  }
});
it('handles unavailable storage on load and reports save failure instead of claiming persistence', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => {
      throw new Error('storage unavailable');
    },
  });
  expect(loadDetectionModel()).toBeUndefined();
  expect(() => saveDetectionModel(config, true)).toThrow('storage unavailable');
});
