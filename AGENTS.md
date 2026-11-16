# AGENTS.md

- Use the Node.js and pnpm versions specified in the root `package.json`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for development commands and package boundaries.
- Build affected workspace packages and their dependencies before running tests. Tests consume compiled output.
- Keep tests minimal and focused on observable behavior. Avoid redundant coverage, assertions tied to implementation details, and unnecessary complexity.
- Follow [.github/pull_request_template.md](./.github/pull_request_template.md) when drafting PR descriptions, and verify each applicable checklist item before checking it off.
- Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.
