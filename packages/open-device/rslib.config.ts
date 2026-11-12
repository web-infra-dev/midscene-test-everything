import { defineConfig } from '@rslib/core';

export default defineConfig({
  source: {
    entry: { index: './src/**/*.ts' },
    tsconfigPath: './tsconfig.build.json',
  },
  lib: [{ format: 'esm', syntax: 'es2022', bundle: false, dts: true }],
  output: { target: 'node', distPath: { root: 'dist' } },
});
