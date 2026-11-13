# AGENTS.md

- Use the Node.js and pnpm versions specified in the root `package.json`. See [CONTRIBUTING.md](./CONTRIBUTING.md) for development commands and package boundaries.
- Build affected workspace packages and their dependencies before running tests. Tests consume compiled output.
- Keep tests minimal and focused on observable behavior. Avoid redundant coverage, assertions tied to implementation details, and unnecessary complexity.
