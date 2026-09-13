# 2. End-to-End Flows

This page follows the common request and message paths through the platform.

## Browser-hosted flow

```mermaid
sequenceDiagram
    participant User as Browser user
    participant UI as clab-ui in browser
    participant WEB as containerlab-app
    participant API as clab-api-server
    participant RT as Runtime

    User->>UI: Trigger action
    UI->>WEB: Call browser-facing route
    WEB->>WEB: Resolve endpoint session and optional topology session
    WEB->>API: Forward to /login or /api/v1/* with bearer token
    API->>RT: Perform runtime or file action
    RT-->>API: Result, logs, or stream
    API-->>WEB: Response or stream
    WEB-->>UI: Browser-safe payload, SSE, or websocket proxy
```

What matters here:

- The browser never talks to the runtime directly.
- `containerlab-app` translates browser-safe routes into API-server calls.
- Auth, superuser checks, and ownership checks happen in `clab-api-server`, not in `clab-ui`.

## VS Code-hosted flow

```mermaid
sequenceDiagram
    participant User as VS Code user
    participant WV as clab-ui webview
    participant EXT as vscode-containerlab
    participant RT as Runtime

    User->>WV: UI action
    WV->>EXT: postMessage command or topology-host request
    EXT->>EXT: Route through MessageRouter or command handlers
    EXT->>RT: File operation, runtime action, or CLI integration
    RT-->>EXT: Output or updated state
    EXT-->>WV: postMessage update or topology-host response
```

What matters here:

- There is no mandatory HTTP gateway in the VS Code path.
- The extension host owns file access, runtime access, and panel lifecycle.
- The webview remains a presentation layer plus message client.

## Local development flow with sibling `clab-ui`

```mermaid
flowchart LR
    Build["Build ../clab-ui/dist"]
    WebLocal["containerlab-app: npm run dev:web:local"]
    VscLocal["vscode-containerlab: npm run build:local-ui or package:local-ui"]

    Build --> WebLocal
    Build --> VscLocal
```

The key rule is simple: if you changed `clab-ui`, rebuild it before expecting the consumers to reflect that change.

## Runtime behavior classes

| Class | Examples | Transport |
|---|---|---|
| Request/response | login, list labs, save topology file, inspect lab | HTTP |
| Long-running stream | platform events, topology file events | streaming HTTP bridged to SSE in the browser host |
| Interactive stream | terminal, VNC | websocket |
| Local extension command | deploy, destroy, inspect, capture inside VS Code | command and message bridge |

## Failure surfaces by flow

| Flow | Typical failure | First place to inspect |
|---|---|---|
| Browser UI -> web host | wrong endpoint session or route mismatch | `containerlab-app/packages/app-server/src/*.ts` |
| Web host -> API server | auth header, route, or query mismatch | `containerlab-app/packages/app-server/src/clabApiClient.ts`, `clab-api-server/internal/api/routes.go` |
| API server -> runtime | privilege or ownership failure | `clab-api-server/internal/api/*.go` |
| Webview -> extension host | message or command mapping drift | `vscode-containerlab/src/reactTopoViewer/extension/panel/MessageRouter.ts` |
