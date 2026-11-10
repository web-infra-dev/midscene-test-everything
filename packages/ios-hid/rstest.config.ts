import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: '@midscene/ios-hid',
  include: ['tests/**/*.test.ts'],
  testEnvironment: 'node',
  restoreMocks: true,
});
