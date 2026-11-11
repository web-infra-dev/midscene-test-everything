import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { expect, it } from '@rstest/core';

const require = createRequire(import.meta.url);
const less = require('less') as {
  render(source: string): Promise<{ css: string }>;
};

it('fits the rectified canvas inside its host instead of clipping it', async () => {
  const source = await readFile(
    new URL('../src/styles.less', import.meta.url),
    'utf8',
  );
  const { css } = await less.render(source);
  const rule = /\.corrected-preview-canvas\s*\{([^}]*)\}/.exec(css)?.[1];
  // The canvas carries pixel dimensions, so hosts must be able to shrink it.
  // Without both limits it renders at its intrinsic width and gets clipped.
  expect(rule).toContain('max-width: 100%');
  expect(rule).toContain('max-height: 100%');
  expect(rule).toContain('height: auto');
});

it('sizes the canvas against a definite track so tall screens are capped', async () => {
  const source = await readFile(
    new URL('../src/styles.less', import.meta.url),
    'utf8',
  );
  const { css } = await less.render(source);
  const rule = /\.range-output\s*\{([^}]*)\}/
    .exec(css)?.[1]
    ?.replace(/\s+/g, ' ');
  // Percentage max-height does not resolve inside an auto-sized grid track, so
  // a portrait preview would still overflow the fixed-height stage.
  expect(rule).toContain('grid-template: minmax(0, 1fr) / minmax(0, 1fr)');
});

it('scrolls a tall corrected preview instead of shrinking its width', async () => {
  const source = await readFile(
    new URL('../src/styles.less', import.meta.url),
    'utf8',
  );
  const { css } = await less.render(source);
  const stage =
    /\.guided-mapping-editor \.corrected-preview-stage\s*\{([^}]*)\}/
      .exec(css)?.[1]
      ?.replace(/\s+/g, ' ');
  expect(stage).toContain('overflow-y: auto');
  const canvas =
    /\.guided-mapping-editor \.corrected-preview-stage \.corrected-preview-canvas\s*\{([^}]*)\}/
      .exec(css)?.[1]
      ?.replace(/\s+/g, ' ');
  // Pane width stays fixed; the screen's own aspect sets the scroll height.
  expect(canvas).toContain('width: 100%');
  expect(canvas).toContain('height: auto');
  expect(canvas).toContain('max-height: none');
});
