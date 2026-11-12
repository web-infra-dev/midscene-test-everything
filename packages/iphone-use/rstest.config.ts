import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: '@midscene/iphone-use',
  include: ['tests/**/*.test.ts'],
  testEnvironment: 'node',
  restoreMocks: true,
});
