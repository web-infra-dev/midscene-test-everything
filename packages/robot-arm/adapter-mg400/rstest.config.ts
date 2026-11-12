import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: '@midscene/arm-adapter-mg400',
  include: ['tests/**/*.test.{ts,mjs}'],
  testEnvironment: 'node',
});
