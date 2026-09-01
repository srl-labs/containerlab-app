# 6. vscode-containerlab

`vscode-containerlab` embeds `clab-ui` inside VS Code webviews and turns UI actions into extension-host operations.

## Core rule

The extension host owns the runtime contract. The webview does not.

That means:

- the webview renders shared UI from `clab-ui`
- the extension host owns commands, file access, and runtime access
- the bridge between them is explicit and message-driven

## Bridge layers

| Layer | Responsibility |
|---|---|
| `src/extension.ts` | command registration and activation |
| `ReactTopoViewerProvider` | open or reuse topology viewers by lab path |
| `TopologyHostCore` | authoritative topology document state for the panel |
| `MessageRouter` | handles topology-host protocol messages and semantic UI commands |
| feature services | lifecycle, node actions, capture, icons, custom nodes, split view |
| watchers | push file and docker-image changes back to the webview |

## Topology viewer flow

1. VS Code registers `containerlab.lab.graph.topoViewer`.
2. `ReactTopoViewerProvider.openViewer(...)` reuses an existing viewer for the same `labPath` or creates a new one.
3. The provider creates a panel and initializes `TopologyHostCore`.
4. The webview sends either topology-host protocol messages or semantic UI commands.
5. `MessageRouter` routes those messages to the correct service.
6. The extension posts responses, snapshots, and push events back to the webview.

## Other webview flows

| Feature | Main entry points |
|---|---|
| Explorer | `src/webviews/explorer/*` |
| Inspect | `src/commands/inspect.ts`, `src/webviews/inspect/*` |
| Welcome | `src/welcomePage.ts`, `src/webviews/welcome/*` |
| Node impairments | `src/commands/nodeImpairments.ts`, `src/webviews/nodeImpairments/*` |
| Capture and Wireshark VNC | `src/commands/capture.ts`, `src/webviews/wiresharkVnc/*` |

## Local `clab-ui` mode

The build config supports a strict sibling-repo override:

- if `CLAB_UI_SOURCE=local` and `../clab-ui/dist/index.js` exists, imports such as `@srl-labs/clab-ui/*` are rewritten to the local `dist/` tree
- otherwise the published package is used

In day-to-day usage you normally call the scripts that already set this flag for you:

```bash
npm run build:local-ui
npm run package:local-ui
```

## How this differs from the browser host

!!! info "Do not mentally model this as the web app inside VS Code"
    The VS Code path does not require the `containerlab-app` gateway. It uses extension APIs, VS Code commands, and local services instead of browser cookies, HTTP proxy routes, and server-managed endpoint sessions.

## Operational prerequisites

The extension expects a local environment that can actually reach the runtime.

Typical blockers are:

- the user is not in the required local groups such as `clab_admins` and `docker`
- the Docker socket is unavailable
- the extension command router and webview messages drift out of sync
