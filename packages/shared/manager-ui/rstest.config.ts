import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: '@midscene/device-manager-ui',
  include: ['tests/**/*.test.mjs'],
  testEnvironment: 'node',
});
