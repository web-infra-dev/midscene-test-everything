import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: '@midscene/open-device-playground',
  include: ['tests/**/*.test.ts'],
  testEnvironment: 'node',
  restoreMocks: true,
});
