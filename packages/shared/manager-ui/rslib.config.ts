import { pluginLess } from '@rsbuild/plugin-less';
import { pluginReact } from '@rsbuild/plugin-react';
import { defineConfig } from '@rslib/core';

export default defineConfig({
  source: {
    entry: { index: ['./src/ModelConfigModal.{tsx,less}'] },
    tsconfigPath: './tsconfig.lib.json',
  },
  lib: [{ format: 'esm', syntax: 'es2020', bundle: false, dts: true }],
  output: { target: 'web', distPath: { root: 'lib' } },
  plugins: [pluginReact(), pluginLess()],
});
