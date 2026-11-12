import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rstest/core';

export default defineConfig({
  name: '@midscene/arm-service',
  plugins: [pluginReact()],
  include: ['tests/**/*.test.{ts,mjs}'],
  testEnvironment: 'node',
});
