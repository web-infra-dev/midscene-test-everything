import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: '@midscene/universal-device',
  include: ['tests/**/*.test.ts'],
  testEnvironment: 'node',
  restoreMocks: true,
});
