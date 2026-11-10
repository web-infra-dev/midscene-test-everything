import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rslib/core';

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: { index: ['./src/**/*.{ts,tsx}', '!./src/setup/standalone/**'] },
    tsconfigPath: './tsconfig.build.json',
  },
  lib: [{ format: 'esm', syntax: 'es2022', bundle: false, dts: true }],
  output: { target: 'node', distPath: { root: 'dist' } },
});
