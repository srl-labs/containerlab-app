# clab-ui

Shared UI package for containerlab webviews and topology editing.

Consumers:

- [`vscode-containerlab`](https://github.com/srl-labs/vscode-containerlab)
- [`containerlab-app`](https://github.com/srl-labs/containerlab-app)

## What This Repo Contains

- React UI and topology editing logic used by containerlab consumers
- Shared parsing, host, session, and runtime helpers
- Package build tooling that emits the published `dist/` output

This repository no longer contains the standalone browser host. That runtime
now lives in `containerlab-app`.

## Requirements

- Node.js `>= 24`
- npm

Install dependencies:

```bash
npm install
```

## Common Commands

| Command | Description |
| --- | --- |
| `npm run build` | Build the published package into `dist/` |
| `npm run typecheck` | Run TypeScript checks |
| `npm run lint` | Typecheck + `oxlint` |
| `npm run test:unit` | Run package unit tests |
| `npm run pack:preview` | Preview package contents |
| `npm run publish:ui` | Publish `@srl-labs/clab-ui` manually |

## Public Package Surface

Supported exports:

- `@srl-labs/clab-ui`
- `@srl-labs/clab-ui/host`
- `@srl-labs/clab-ui/session`
- `@srl-labs/clab-ui/theme`
- `@srl-labs/clab-ui/explorer`
- `@srl-labs/clab-ui/inspect`
- `@srl-labs/clab-ui/welcome`
- `@srl-labs/clab-ui/node-impairments`
- `@srl-labs/clab-ui/wireshark-vnc`
- `@srl-labs/clab-ui/styles/global.css`

Deep `core/*`, `services/*`, and `src/*` imports are not part of the supported
public API.

Integrator-facing guidance for these exports lives in
[`INTEGRATORS.md`](INTEGRATORS.md). If you are embedding this package into your
own app, start there.

## Local Consumer Workflow

When another local repo wants to consume this checkout directly, build it first:

```bash
npm install
npm run build
```

`vscode-containerlab` can then opt into its local override mode and resolve
against this repo's `dist/` output.

## Publishing

`@srl-labs/clab-ui` is published to GitHub Packages through
`.github/workflows/publish-package.yml`.

Release flow:

1. Bump `package.json` version.
2. Commit and push.
3. Create tag `v<version>` matching the package version.
4. Push the tag to trigger publish.

Detailed steps: [`PUBLISHING.md`](PUBLISHING.md)
