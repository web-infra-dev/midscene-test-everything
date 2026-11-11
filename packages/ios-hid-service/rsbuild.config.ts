import path from 'node:path';
import { defineConfig } from '@rsbuild/core';
import { pluginLess } from '@rsbuild/plugin-less';
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginSvgr } from '@rsbuild/plugin-svgr';
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
      async_hooks: path.resolve(
        __dirname,
        '../playground/src/ui/vendor/polyfills/async-hooks.ts',
      ),
      'node:async_hooks': path.resolve(
        __dirname,
        '../playground/src/ui/vendor/polyfills/async-hooks.ts',
      ),
    },
  },
  output: { distPath: { root: 'dist/ui' }, externals: ['sharp'] },
  html: { title: 'Midscene iOS HID Device Service' },
});
