# @containerlab/clab-ui

Shared React UI, topology editing, and host/session helpers for Containerlab web, desktop, and VS Code applications. Source lives in `packages/clab-ui` in the [containerlab-app monorepo](https://github.com/srl-labs/containerlab-app).

## Install

```sh
npm install @containerlab/clab-ui react react-dom
```

Use Node.js >=24 and React 19.2.5 or newer within React 19. The public npm package does not require a GitHub token. Consumers migrating from `@srl-labs/clab-ui` must update the dependency name and import paths.

## Public entrypoints

| Entrypoint | Purpose |
| --- | --- |
| `@containerlab/clab-ui` | Topology UI and store |
| `/host`, `/session` | Host integration and topology sessions |
| `/theme`, `/styles/global.css` | Theme and shared styles |
| `/explorer` | Explorer UI and snapshots |
| `/image-manager`, `/image-manager/catalog` | Image UI and catalog helpers |
| `/inspect`, `/welcome`, `/node-impairments`, `/wireshark-vnc` | Auxiliary webviews |
| `/viewer`, `/viewer/static/*` | Embeddable viewer and static assets |
| `/monaco/core`, `/monaco/editor-worker`, `/monaco/json-worker`, `/monaco/yaml-worker`, `/monaco-assets.json` | Editor integration |
| `/yaml` | YAML completion and hover helpers |

Use the package name followed by the subpath above. Deep `src/*` and `core/*` imports are unsupported. See [INTEGRATORS.md](INTEGRATORS.md) for examples.

## Contribute

From the monorepo root, with Node.js 24.18.0:

```sh
corepack enable
corepack pnpm install --frozen-lockfile
pnpm ui
pnpm --filter @containerlab/clab-ui run typecheck
pnpm --filter @containerlab/clab-ui run test:unit
pnpm test:package
```

Hosts use the local workspace's built `dist/` exports. Rebuild the UI after source changes. `pnpm ui` builds this library; `pnpm ui:pack` also builds the standalone iframe viewer in `dist-viewer/` and packs both outputs. The isolated package test checks every public entrypoint with TypeScript, bundles a browser consumer, and runs the Node-compatible APIs against the packed npm artifact.

## Release

Bump `packages/clab-ui/package.json`, validate the package, and publish a GitHub Release tagged `clab-ui-v<version>`. `.github/workflows/publish-clab-ui.yml` publishes the tested tarball to npmjs.org. Pushing a tag alone does not publish. Other applications are released independently.

See the monorepo [release guide](https://github.com/srl-labs/containerlab-app/blob/main/RELEASING.md) for secrets, channels, and first-publication setup.
