# 3. clab-ui Package

`clab-ui` is the shared, publishable package consumed by `containerlab-app` and `vscode-containerlab`.

## What `clab-ui` owns

- Shared React UI for topology editing and viewing
- Host contracts that let the same UI run in different products
- The topology session client and related protocol helpers
- Explorer, inspect, welcome, node-impairment, and Wireshark/VNC feature entrypoints
- Shared theme and stylesheet helpers

## What `clab-ui` does not own

- API authentication and authorization policy
- Linux user and group checks
- Container runtime privileges
- Browser endpoint sessions or VS Code command registration
- Topology session creation and disposal in the host product

## Public package surface

The supported integration boundary is the export map in `package.json`.

| Export | What it is for |
|---|---|
| `@srl-labs/clab-ui` | main `App`, message subscription helper, and shared store helpers |
| `@srl-labs/clab-ui/host` | host contracts, runtime factories, runtime context hooks, controller helpers |
| `@srl-labs/clab-ui/session` | `TopologyRef`, topology session client, message constants, schema helpers, topology runtime helpers |
| `@srl-labs/clab-ui/theme` | `MuiThemeProvider` plus theme-variable helpers |
| `@srl-labs/clab-ui/explorer` | explorer view exports and snapshot-building helpers |
| `@srl-labs/clab-ui/inspect` | inspect webview bootstrapper and related types |
| `@srl-labs/clab-ui/welcome` | welcome-page bootstrapper |
| `@srl-labs/clab-ui/node-impairments` | node impairments webview bootstrapper and types |
| `@srl-labs/clab-ui/wireshark-vnc` | Wireshark/VNC webview bootstrapper and types |
| `@srl-labs/clab-ui/styles/global.css` | shared global stylesheet |

!!! warning "Unsupported imports"
    Do not import from `src/*`, `core/*`, `services/*`, or other repo-internal paths. Those are implementation details, not compatibility promises.

## Integration model

Every host follows the same basic pattern.

1. Implement or choose a `ClabUiHost`.
2. Create a runtime with `createClabUiRuntime(...)`.
3. Create and manage any host-owned topology session outside the package.
4. Set session context before the first topology snapshot request.
5. Render the app or feature entrypoint.

The important subtlety is that `clab-ui` does not create topology sessions for you. It consumes a host contract; it does not own host lifecycle.

## Host contract pattern

`clab-ui` expects a host implementation that can do three kinds of work:

- accept semantic UI commands such as lifecycle, node, capture, icon, and export actions
- serve topology snapshots and commands through the topology-host protocol or HTTP adapter
- push async updates back into the UI

That is what allows the same package to run in a browser host and in a VS Code webview without changing the app code.

## Session and revision semantics

The default topology session client created by `createClabUiRuntime(...)` tracks:

- `context`: topology reference, path, mode, deployment state, session id, and runtime container hints
- `revision`: the current topology revision, starting at `1` unless the host sets something else

The host is expected to keep that state aligned with authoritative topology state.

## Build, test, and package commands

```bash
npm install
npm run build
npm run typecheck
npm run lint
npm run test:unit
npm run pack:preview
```

## Publish flow

```bash
npm run publish:ui
```

In normal release flow, publishing is triggered by the repository workflow rather than by a manual local publish.

1. Bump the version in `package.json`.
2. Commit and push.
3. Create a matching `vX.Y.Z` tag.
4. Push the tag so `.github/workflows/publish-package.yml` runs.

## Local consumer workflow

If another local repo should consume this checkout directly:

```bash
cd /home/flschwar/projects/clab/clab-ui
npm install
npm run build
```

After that:

- `containerlab-app` can use `npm run dev:web:local`
- `vscode-containerlab` can use `npm run build:local-ui` or `npm run package:local-ui`
