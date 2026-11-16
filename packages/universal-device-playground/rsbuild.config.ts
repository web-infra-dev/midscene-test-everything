import { defineConfig } from '@rsbuild/core';
import { pluginReact } from '@rsbuild/plugin-react';

export default defineConfig({
  plugins: [pluginReact()],
  source: { entry: { connect: './src/ui/connect.tsx' } },
  output: {
    assetPrefix: '/open-device/ui/',
    distPath: { root: 'dist/ui' },
  },
});
