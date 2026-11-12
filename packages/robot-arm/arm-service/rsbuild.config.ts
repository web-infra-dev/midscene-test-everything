import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from '@rsbuild/core';
import { pluginLess } from '@rsbuild/plugin-less';
import { pluginNodePolyfill } from '@rsbuild/plugin-node-polyfill';
import { pluginReact } from '@rsbuild/plugin-react';
import { pluginSvgr } from '@rsbuild/plugin-svgr';

const polyfill = createRequire(import.meta.url).resolve(
  '@midscene/device-manager-ui/async-hooks',
);

export default defineConfig({
  source: { entry: { index: './src/ui/index.tsx' } },
  plugins: [
    pluginReact(),
    pluginLess(),
    pluginNodePolyfill(),
    pluginSvgr({ mixedImport: true }),
  ],
  resolve: {
    alias: {
      '@midscene/robotics-shared': path.resolve(
        __dirname,
        '../../shared/utils/src',
      ),
      '@midscene/arm-kit/internal/camera/vision-geometry$': path.resolve(
        __dirname,
        '../arm-kit/src/camera/vision-geometry.ts',
      ),
      '@midscene/arm-kit/contracts$': path.resolve(
        __dirname,
        '../arm-kit/src/contracts.ts',
      ),
      async_hooks: polyfill,
      'node:async_hooks': polyfill,
    },
  },
  output: { distPath: { root: 'dist/ui' }, externals: ['sharp'] },
  tools: {
    rspack: {
      ignoreWarnings: [
        {
          module: /[\\/]node_modules[\\/]@midscene[\\/]core[\\/]/,
        },
      ],
    },
  },
  html: { title: 'Arm Device Manager' },
});
