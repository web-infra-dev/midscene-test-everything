import { defineConfig } from '@rsbuild/core';
import { pluginLess } from '@rsbuild/plugin-less';
import { pluginReact } from '@rsbuild/plugin-react';
export default defineConfig({
  plugins: [pluginReact(), pluginLess()],
  tools: {
    rspack: { resolve: { extensionAlias: { '.js': ['.ts', '.tsx', '.js'] } } },
  },
  source: { entry: { index: './src/setup/standalone/index.tsx' } },
  // Inline scripts run immediately, even with defer. Mount after the root exists.
  html: { title: 'Midscene 摄像头设置', mountId: 'root', inject: 'body' },
  output: {
    distPath: { root: 'dist/setup-page' },
    inlineScripts: true,
    inlineStyles: true,
    sourceMap: false,
  },
});
