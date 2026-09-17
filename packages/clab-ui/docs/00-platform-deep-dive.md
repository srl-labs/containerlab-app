# 0. Platform Deep Dive

This is the fastest full-system explanation of how the four repos fit together, where control actually lives, and which seams are most likely to break.

## In one minute

!!! abstract "What actually happens"
    - `clab-ui` is the reusable UI package.
    - `containerlab-app` hosts that package in the browser and forwards privileged work to `clab-api-server`.
    - `vscode-containerlab` hosts the same package inside VS Code webviews and routes work through extension commands and services.
    - `clab-api-server` is the runtime authority for browser-hosted flows.

## Main components

| Component | Primary role | Typical consumer-facing surface |
|---|---|---|
| `clab-ui` | Shared package and contracts | `@containerlab/clab-ui` exports |
| `containerlab-app` | Browser SPA host, endpoint-session manager, gateway | `/auth/*`, `/files`, `/api/*` |
| `clab-api-server` | Authenticated control plane and runtime access | `/login`, `/api/v1/*` |
| `vscode-containerlab` | Extension host and webview bridge | VS Code commands, `postMessage` bridge |

## Trust and control boundaries

```mermaid
flowchart LR
    Browser["Browser user"]
    VSCode["VS Code user"]
    UI["@containerlab/clab-ui"]
    WebHost["containerlab-app"]
    Extension["vscode-containerlab"]
    API["clab-api-server"]
    Runtime["Container runtime and containerlab"]

    Browser --> WebHost
    VSCode --> Extension
    WebHost --> UI
    Extension --> UI
    WebHost --> API
    API --> Runtime
    Extension --> Runtime
```

Important boundary rules:

- Browser code never owns privileged runtime operations directly.
- The web host is a transport and session layer, not the final policy authority.
- The VS Code webview is also not the authority. The extension host is.
- `clab-ui` portability is a UX and reuse benefit, not a security boundary.

## Two hosting modes

| Dimension | Browser-hosted path | VS Code-hosted path |
|---|---|---|
| Host repo | `containerlab-app` | `vscode-containerlab` |
| Transport | HTTP, SSE, websocket, browser cookies | VS Code `postMessage`, command dispatch |
| Runtime owner | `clab-api-server` | extension services and local runtime integration |
| Auth gate | endpoint session + JWT | extension activation and local environment checks |
| High-risk drift | route/session/proxy mismatch | command/message router mismatch |

## Canonical browser path

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as containerlab-app
  participant A as clab-api-server
  participant R as Runtime

  B->>W: Browser-facing route under /api/* or /auth/*
  W->>W: Resolve endpoint session and optional topology session
  W->>A: Forward to /login or /api/v1/* with bearer token
  A->>A: Auth, ownership, and policy checks
  A->>R: Runtime operation or stream setup
  R-->>A: Result or stream
  A-->>W: Response, NDJSON, or websocket stream
  W-->>B: Browser-safe response or proxy stream
```

## Canonical VS Code path

```mermaid
sequenceDiagram
  participant WV as clab-ui webview
  participant EX as Extension host
  participant S as Extension services
  participant R as Runtime

  WV->>EX: postMessage command or topology-host request
  EX->>S: Route through MessageRouter or command handler
  S->>R: Run local action, file update, or runtime command
  R-->>S: Output, state, or error
  S-->>EX: Normalized payload
  EX-->>WV: postMessage update or topology-host response
```

## Cross-repo contracts that matter most

| Contract | Producer | Consumer |
|---|---|---|
| Export map for `@containerlab/clab-ui/*` | `clab-ui` | web and VS Code hosts |
| `ClabUiHost` and topology session semantics | `clab-ui` | host implementations |
| Browser-facing gateway routes | `containerlab-app` | browser app code and `clab-ui` API host usage |
| `/api/v1/*` semantics | `clab-api-server` | `containerlab-app` |
| Extension commands and bridge message handling | `vscode-containerlab` | `clab-ui` webviews |

## Highest-risk coupling points

| Risk | Why it breaks | First place to inspect |
|---|---|---|
| Export drift | consumer imports a subpath that is no longer exported | `clab-ui/package.json`, consumer imports |
| Host contract drift | required host methods are missing or partially implemented | `clab-ui/src/host/contracts.ts`, host implementation |
| Route mapping drift | browser-facing route no longer matches API upstream behavior | `containerlab-app/packages/app-server/src/*.ts` |
| Endpoint or topology session drift | wrong endpoint or stale topology session selected | `containerlab-app/packages/app-server/src/middleware.ts`, `topologySessionManager.ts` |
| Extension command drift | webview sends a command with no matching handler | `vscode-containerlab/src/extension.ts`, `MessageRouter.ts` |

## Auth and ownership pipeline

```mermaid
flowchart LR
    Req["API request"] --> CORS["CORS middleware"]
    CORS --> Auth["JWT auth middleware"]
    Auth --> Superuser["Optional superuser gate"]
    Superuser --> Ownership["Lab or container ownership checks"]
    Ownership --> Handler["Feature handler"]
```

Status codes you will see often:

- `401`: missing, malformed, expired, or invalid bearer token
- `403`: authenticated, but the action is explicitly forbidden
- `404`: resource not found, or intentionally concealed by ownership policy

## Streams and long-lived connections

| Stream class | Browser-facing path | Typical failure mode |
|---|---|---|
| Platform event feed | `/api/events` | endpoint session expired or upstream stream failure |
| Topology file events | `/api/topology/events` | stale topology session or lab path mismatch |
| Terminal websocket | `/api/runtime/terminal-sessions/:id/stream` | terminal session expired or upstream websocket closes |
| VNC websocket | `/api/runtime/capture/wireshark-vnc-sessions/:id/vnc/websockify` | capture-session mapping missing or upstream not ready |

## Local development contract

All TypeScript products live in the monorepo. Both normal and `:local` app commands rebuild `packages/clab-ui` and resolve its workspace exports. Uncommitted UI changes are included; npm publication is not part of local testing.

```mermaid
flowchart LR
    Source["packages/clab-ui/src"] --> UI["pnpm ui:local (hot reload)"]
    Source --> Build["Build workspace UI dist"]
    Build --> Web["pnpm web / web:local"]
    Build --> VSIX["pnpm vsix / vsix:local"]
    Build --> Desktop["pnpm desktop / desktop:local"]
```

Rerun the app command after further UI edits, or run `pnpm ui` and reload the host. The UI harness watches source directly; other hosts consume built exports.

## Release contract

| Step | Source of truth |
| --- | --- |
| UI package version | `packages/clab-ui/package.json` |
| UI release trigger | Published GitHub Release tagged `clab-ui-vX.Y.Z` |
| Publish workflow | `.github/workflows/publish-clab-ui.yml`, npm Trusted Publishing |
| Bundled application UI | Workspace code from that application's release commit |

Each product has its own release version. GitHub Latest is reserved for stable desktop releases; npm and GHCR have their own independent latest tags. See [RELEASING.md](https://github.com/srl-labs/containerlab-app/blob/main/RELEASING.md).

## Quick contributor commands

From the monorepo root:

```sh
pnpm ui:local
pnpm web:local
pnpm vsix:local
pnpm desktop:local
pnpm test:package
```

## Deeper references

- [11. Web Route and Proxy Matrix](11-web-route-and-proxy-matrix.md)
- [12. API Endpoint Taxonomy](12-api-endpoint-taxonomy.md)
- [13. VS Code Bridge Contract](13-vscode-bridge-contract.md)
- [14. clab-ui Contract Spec](14-clab-ui-contract-spec.md)
- [15. Failure Mode Atlas](15-failure-mode-atlas.md)
