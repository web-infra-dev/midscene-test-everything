# Contributing to Midscene Robotics

## Local setup

Use a Node.js version supported by `engines.node` and the pnpm version pinned by `packageManager` in [package.json](./package.json). From the repository root, run the following commands.

```sh
pnpm install
pnpm build
```

## Build and test

Workspace packages import compiled output. Rebuild the affected package and its dependencies before running a focused suite. For example, to work on iOS AirLink, run the following commands.

```sh
pnpm --filter @midscene/ios-airlink... -r build
pnpm --filter @midscene/ios-airlink test
```

Keep regression tests in the owning package's `tests/` directory. Use simulated hardware for automated tests. When reporting validation for hardware changes, describe simulated and physical results separately. Before moving physical hardware, obtain operator confirmation and use measured setup values and verified routes.

To run the repository checks after a full build, use these commands.

```sh
pnpm lint:check
pnpm typecheck
pnpm test
```

## Package boundaries

- Keep vendor commands, units, and completion checks in adapters that implement `@midscene/arm-kit/adapter-development`. The controller owns the queue shared by its devices.
- Keep shared browser-safe types and camera geometry in `packages/shared/utils`, user-facing controls in `packages/universal-device-playground`, and MG400 setup and calibration in `packages/robot-arm/arm-service`.
- For calibration packaging changes, build and pack the arm service. Check that the package contains the built manager UI and exercise the embedded calibration routes with the test adapter.

## Documentation

Keep the root READMEs focused on the project overview and quick start. Update both languages when that content changes. Document protocol and action changes in the [Universal Device RFC](./packages/universal-device/rfc/index.html) and the [API schema](./packages/universal-device/src/server/openapi.ts). Keep credentials and local machine settings out of examples.

## Pull requests

Open a pull request against `main` from a branch for your change. Use scoped Conventional Commits for commit messages, for example `fix(ios-airlink): handle a disconnected device`. Summarize what changed and complete the [PR checklist](./.github/pull_request_template.md) with the checks you ran.
