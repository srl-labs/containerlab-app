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
| `@containerlab/clab-ui` | main `App`, message subscription helper, and shared store helpers |
| `@containerlab/clab-ui/host` | host contracts, runtime factories, runtime context hooks, controller helpers |
| `@containerlab/clab-ui/session` | `TopologyRef`, topology session client, message constants, schema helpers, topology runtime helpers |
| `@containerlab/clab-ui/theme` | `MuiThemeProvider` plus theme-variable helpers |
| `@containerlab/clab-ui/explorer` | explorer view exports and snapshot-building helpers |
| `@containerlab/clab-ui/inspect` | inspect webview bootstrapper and related types |
| `@containerlab/clab-ui/welcome` | welcome-page bootstrapper |
| `@containerlab/clab-ui/node-impairments` | node impairments webview bootstrapper and types |
| `@containerlab/clab-ui/wireshark-vnc` | Wireshark/VNC webview bootstrapper and types |
| `@containerlab/clab-ui/styles/global.css` | shared global stylesheet |

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
pnpm --filter @containerlab/clab-ui run build
pnpm --filter @containerlab/clab-ui run typecheck
pnpm --filter @containerlab/clab-ui run lint
pnpm --filter @containerlab/clab-ui run test:unit
pnpm --filter @containerlab/clab-ui run pack:preview
```

## Publishing and local development

The package is developed at `packages/clab-ui` in the `containerlab-app` pnpm workspace and published on npmjs.org as `@containerlab/clab-ui`.

From the workspace root use `ppnpm --filter @containerlab/clab-ui run build:clab-ui` and `ppnpm --filter @containerlab/clab-ui run test:package:clab-ui`. Publish a GitHub Release tagged `clab-ui-v<version>` matching `packages/clab-ui/package.json` to publish the tested package. See [Local development and releases](07-local-dev-and-release.md).
