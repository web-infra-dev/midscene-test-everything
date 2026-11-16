import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: '@midscene/ios-airlink',
  include: ['tests/**/*.test.ts'],
  testEnvironment: 'node',
  restoreMocks: true,
});
