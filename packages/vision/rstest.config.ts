import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: '@midscene/robotics-vision',
  include: ['tests/**/*.test.ts'],
  testEnvironment: 'node',
  restoreMocks: true,
});
