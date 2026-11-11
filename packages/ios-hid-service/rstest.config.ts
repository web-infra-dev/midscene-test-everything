import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: '@midscene/ios-hid-service',
  include: ['tests/**/*.test.ts'],
  testEnvironment: 'node',
  restoreMocks: true,
});
