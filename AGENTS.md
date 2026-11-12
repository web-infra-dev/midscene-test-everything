# AGENTS.md

These instructions apply throughout Midscene Arm Kit. Start with the [README](./README.md) for setup and usage.

## Development workflow

- Use pnpm 9.3.0 and a Node.js version supported by the root package manifest. Install dependencies from the repository root.
- Run `pnpm build` after installation. Workspace packages import compiled entry points. To rebuild one package and its dependencies, use a filter such as `pnpm --filter @midscene/arm-kit... -r build`.
- Keep regression tests in the owning package’s or app’s `tests/` directory. Start with the relevant suite, for example `pnpm --filter @midscene/arm-kit test`. Run `pnpm typecheck` for changes to shared types or package exports.
- Before submitting changes, run `pnpm lint:check`. The separate `pnpm lint` command applies fixes. Edit sources and rebuild generated files when needed.
- When changing calibration packaging, build and pack the arm service. Verify the package includes its built manager UI, and exercise the embedded calibration routes with the test adapter.

## Package boundaries and hardware

- Keep vendor commands, units and measured completion in the adapter. Implement adapters against `@midscene/arm-kit/adapter-development`. The Controller owns the action queue shared by its Devices.
- Put browser-safe protocol types and camera geometry used by both the SDK and UI in `packages/shared/utils`. The arm service owns the calibration UI and embedded web entry points.
- Keep the user Playground in `packages/open-device-playground` and MG400 configuration and network prompts in `packages/robot-arm/arm-service`.
- Use the test adapter for automated checks. For physical movement, obtain operator confirmation and use measured setup values and verified routes. Report simulated and hardware results separately.

## Documentation

Update the English and Chinese READMEs together when commands, package boundaries or public behavior change. Keep model credentials and local machine settings out of examples.
