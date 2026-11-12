Vendored React shell from web-infra-dev/midscene v1.17.5, commit fa2ecdff05106b71b210298bcd8b8c9cd80e52d6 (MIT).

Local changes: visualizer imports reuse the adjacent vendored components; PlaygroundApp exposes renderSetup, renderPreview and renderPendingPreview slots, an optional workspaceHeader slot, and an optional sessionReady guard for platforms that verify hardware readiness separately. SVG component imports use ?react for Rsbuild; SVG declarations reuse the adjacent visualizer declarations. Original layout, styles, controller, model settings and task UI are retained.
