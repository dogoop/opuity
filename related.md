# Related Projects

This document describes how the repositories under the Opuity project relate to
each other, what each one owns, and how they depend on one another.

## The Two Repositories

| Repository | Purpose | Published |
| --- | --- | --- |
| [`opuity`](https://github.com/snooopdog/opuity) | Core SDKs, MCP server, CLI, docs, examples, tooling. | Yes — npm and PyPI |
| [`opuity-frontend`](https://github.com/snooopdog/opuity-frontend) | Next.js App Router x402 pay-gated seller app. | No — reference app |

Both are standalone repositories under the same organization and maintainers.
Neither is a Git submodule or subtree of the other.

## Shared Origin

Both repositories were split from the original **Nirium** codebase
(`nirium-protocol/nirium`). As a result:

- Each repository inherits the **complete Git history** of the original project,
  including the pre-split commits and the tagged release `v0.16.0`.
- The split commits are additive: history was preserved, not squashed or
  rewritten.
- The rename to **Opuity** applies to the project and repository names. Package
  identifiers on npm/PyPI (`nirium`, `nirium-mcp`, `nirium-cli`) are unchanged,
  so installs and imports continue to work.

## What Each Repository Contains

`opuity` (this repository) holds everything that is language-level or
server-side:

- TypeScript SDK (`packages/sdk`) and Python SDK (`packages/sdk-python`).
- MCP server (`packages/mcp`) and CLI (`packages/cli`).
- Documentation (`docs/`), runnable examples (`examples/`), reusable GitHub
  Actions (`actions/`), and editor skills (`skills/`).

`opuity-frontend` holds the single Next.js application that was previously
`examples/nextjs-x402` in the original mono-layout. It was moved to the root of
its own repository so it installs and runs independently.

## How They Depend on Each Other

The dependency is **one-directional and weak**:

- `opuity-frontend` consumes the published **`nirium` npm package** — the SDK
  shipped from `opuity`. It does not import source from the `opuity` working
  tree and is not wired as a workspace.
- `opuity` does **not** depend on `opuity-frontend`. Nothing in the SDK, MCP
  server, CLI, or examples imports the frontend app.

Consequences:

- The two repositories can be built, tested, and released on independent
  schedules. Breaking either one locally does not break the other.
- The frontend tracks the SDK through a normal semver dependency
  (`"nirium": "^0.10.1"`), not a pinned commit, so it can adopt new SDK releases
  deliberately.
- The split kept the frontend runnable: `npm install && npm run dev` works with
  no reference to the core repository.

## Shared Governance

Both repositories follow the same contribution model described in
[`plan.md`](./plan.md) (the Wave Program): maintainers scope issues, contributors
claim them during sprint cycles, and the same Definition of Done and review
standards apply to either repository. Area labels distinguish work in the core
(`area:sdk`, `area:cli`, `area:docs`) from work in the app (`area:frontend`).

## Documentation Cross-References

- The `opuity` README links to `opuity-frontend` as the home of the Next.js
  App Router paywall.
- The `opuity-frontend` README links back to `opuity` for the SDK, security
  policy, and the main project description.

## Summary

`opuity` is the core library and tooling repository; `opuity-frontend` is a
downstream, independently runnable application that depends only on published
SDK artifacts. They share an origin, a history, and a governance model, but not
a build or release pipeline.
