import path from 'node:path';
import { defineConfig } from '@rsbuild/core';
import { pluginLess } from '@rsbuild/plugin-less';
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginSvgr } from '@rsbuild/plugin-svgr';

const polyfill = path.resolve(__dirname, './src/ui/async-hooks.ts');

export default defineConfig({
  plugins: [
    pluginReact(),
    pluginLess(),
    pluginSvgr({ mixedImport: true }),
    pluginNodePolyfill(),
  ],
  source: { entry: { index: './src/ui/index.tsx' } },
  resolve: {
    alias: {
      async_hooks: polyfill,
      'node:async_hooks': polyfill,
    },
  },
  output: { distPath: { root: 'dist/ui' }, externals: ['sharp'] },
  html: { title: 'Midscene iPhone Use' },
});
