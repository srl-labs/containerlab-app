# Local development and releases

All TypeScript products now live in the `containerlab-app` pnpm workspace. The Go API server remains separate.

## Setup

From the monorepo root, using Node.js 24.18.0:

```sh
corepack enable
corepack pnpm install --frozen-lockfile
pnpm web:local
# or: pnpm pages:local
# or: pnpm desktop:local
# or: pnpm vsix:local
```

The applications consume `@containerlab/clab-ui` through `workspace:*`. Their root commands build the UI before starting. Rebuild with `pnpm ui` after UI edits; the app commands do not watch UI source. Use `pnpm ui:local` for source hot reload in the UI harness; no sibling checkout is needed.

## Validation

```sh
pnpm typecheck
pnpm test
pnpm test:package
pnpm test:web
pnpm test:vscode
```

The package test installs the packed artifact with npm outside the workspace and validates all public declarations, browser bundling, and Node-compatible APIs.

## Independent releases

Publish a GitHub Release at a reviewed commit. The tag chooses the product and must match its manifest:

| Tag | Manifest | Destination |
| --- | --- | --- |
| `clab-ui-v<version>` | `packages/clab-ui/package.json` | npmjs.org: `@containerlab/clab-ui` |
| `vscode-v<version>` | `apps/vscode-containerlab/package.json` | Marketplace, Open VSX, VSIX |
| `web-v<version>` | `apps/web/package.json` | GHCR |
| `desktop-v<version>` | `apps/desktop/package.json` | GitHub installer assets |

A tag push alone does not publish. Only desktop releases should be marked GitHub **Latest**. A shared UI release does not update previously shipped applications.

The full maintainer instructions, required secrets, and prerelease rules are in [RELEASING.md](https://github.com/srl-labs/containerlab-app/blob/main/RELEASING.md).
