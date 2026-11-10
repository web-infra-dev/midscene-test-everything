# Vendored Midscene visualizer

Copy from: https://github.com/web-infra-dev/midscene/tree/v1.17.5/packages/visualizer/src

- Repository: `web-infra-dev/midscene` (official upstream, not midscene-private)
- Tag: `v1.17.5`
- Commit: `fa2ecdff05106b71b210298bcd8b8c9cd80e52d6`
- Copied on: 2026-11-05
- License: MIT; see `LICENSE` copied from the same upstream revision.
- Scope: the relative dependency closure of `UniversalPlayground` and `EnvConfig`,
  plus their types, styles, icons and original context-preview fixture. This is
  not a full copy of the monorepo or the visualizer package. The shared React shell also reuses Logo, NavActions, ScreenshotViewer and the upstream theme through shell.ts.

`upstream-files.json` records the original SHA-256 of every copied file, the
source archive checksum, and an explicit list of locally changed/added files.
Files outside that list are kept unchanged from this official revision.
In particular, `store/store.tsx` keeps model configuration global/shared,
just like upstream.

## Small local extensions

### Optional prompt history namespace

```tsx
<UniversalPlayground
  playgroundSDK={sdk}
  config={{
    storageNamespace: task.id, // upstream: conversation/results
    historyNamespace: task.id, // local: prompt history and last selected API
  }}
/>
```

`historyNamespace` is optional. Omission preserves the original shared history
keys (`midscene-prompt-history-v2`, `midscene-last-selected-type`). A supplied
namespace uses separate storage keys and a store shared by components using that
same namespace. Different namespaces do not copy or fall back to each other's
history. Namespaced stores remain cached for the lifetime of the page; persisted
history survives reloads. Deduplication and the ten-items-per-API limit are kept.
No task or device identifiers are generated inside the vendor.

### Host-supplied translations

`config.translate(message, values)` translates the task UI. It defaults to
English with `{0}` interpolation. `PlaygroundTranslationContext.Provider` can
also wrap `EnvConfig`, which uses the same translator. Dictionaries and the
language preference live outside this directory in the host application.
Model configuration continues to be shared; translation adds no model store,
backend configuration calls or task ownership.

The translation-only extension was adapted from the earlier bilingual work
(midscene-private commit `60935b003`), applied onto the official files above;
the model dialog translations were added locally. These changes are explicitly
local customizations, not claimed to be part of official v1.17.5.

### Build integration

SVG component imports use `?react` for the host's Rsbuild/SVGR configuration.
One `@/utils` import is made relative. No copied styles or replay engine logic
are replaced. The host owns execution readiness checks via upstream
`onBeforeExecutionStart` and disables the panel externally; there is no local
`submissionBlocked` API or `TaskEnvProvider`.

## Updating the copy

1. Download a specific official tag/commit, not the moving `main` branch.
2. Refresh the selected dependency closure and record its original hashes.
3. Reapply only the documented translation, history and import adaptations;
   remove extensions that the new upstream version already supports.
4. Review the local-change list, run Playground `typecheck`, `build`, `test`,
   and verify model sharing, history isolation/default sharing, locale switching
   and execution/cancellation in the browser.

Do not run bulk formatting over untouched upstream files: keep the provenance
comparison useful. This directory is excluded from the repository's bulk lint
and format commands; TypeScript/build and the host integration tests still run.

The config-modal entry delegates to `@midscene/arm-calibration-ui/model-config` so task settings and camera calibration share the same form and Verify UI. Translation remains supplied by the Playground context.
