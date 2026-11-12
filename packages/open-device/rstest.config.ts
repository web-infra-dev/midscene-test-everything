import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: '@midscene/open-device',
  include: ['tests/**/*.test.ts'],
  testEnvironment: 'node',
  restoreMocks: true,
});
