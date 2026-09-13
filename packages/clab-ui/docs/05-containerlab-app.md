# 5. containerlab-app

`containerlab-app` is the standalone app monorepo for the web and desktop hosts around `clab-ui`. Its shared app server owns browser sessions, endpoint selection, topology-session state, and the translation from browser-safe routes to `clab-api-server` calls.

## Runtime shape

- Frontend: Vite SPA using `@srl-labs/clab-ui`
- Backend: Fastify server with explicit route modules
- Desktop: Electron host reusing the shared app server and built web assets
- Production: Fastify serves built assets and browser-facing API routes from one process

## Why this repo exists

A browser app cannot safely own the full runtime contract by itself.

`containerlab-app` centralizes:

- endpoint login and token storage per browser session
- selection of the active API endpoint
- creation and disposal of topology sessions
- stream and websocket forwarding for terminal and VNC flows
- translation from browser-facing routes to `/login` and `/api/v1/*`

## Key moving parts

| Area | What it does | Main files |
|---|---|---|
| Endpoint session store | stores one browser session with one or more connected API endpoints | `packages/app-server/src/endpointSessionStore.ts`, `packages/app-server/src/auth.ts` |
| Topology session manager | keeps topology-host sessions separate from browser auth sessions | `packages/app-server/src/topologySessionManager.ts`, `packages/app-server/src/topologyProxy.ts` |
| Browser auth routes | login, reconnect, endpoint management, logout | `packages/app-server/src/auth.ts` |
| Runtime and lifecycle proxies | inspect, save, SSH, terminal, capture, netem, deploy/destroy/redeploy | `packages/app-server/src/runtimeProxy.ts`, `packages/app-server/src/labProxy.ts` |
| Stream and websocket proxies | events, topology events, terminal stream, VNC websockify | `packages/app-server/src/eventsProxy.ts`, `packages/app-server/src/topologyEventsProxy.ts`, `packages/app-server/src/terminalStreamProxy.ts`, `packages/app-server/src/captureVncStreamProxy.ts` |

## Route families

| Route family | Purpose |
|---|---|
| `/auth/*` | browser-session and endpoint management |
| `/files` | topology listing for explorer flows |
| `/api/topology/*` | topology session lifecycle, snapshot, command, and topology-file events |
| `/api/lab/*` | deploy, destroy, redeploy, and lab-status flows |
| `/api/runtime/*` | inspect, save, SSH, logs, terminal, netem, capture, icons, custom nodes, topology-file create/delete |
| `/api/events` | platform event SSE bridge |

## Development commands

```bash
npm install
npm run dev:web
npm run dev:web:local
npm run build
npm run start
```

Notes:

- `npm run dev:web:local` checks for a built sibling `../clab-ui/dist` and sets local-ui mode automatically.
- `CLAB_API_URL` controls the default API endpoint the web host offers to the browser.

## Operational reality

!!! warning "Frontend healthy does not mean platform healthy"
    A working SPA build with broken Fastify route wiring is still a broken product. For web-hosted flows, the gateway layer is part of the application, not just infrastructure glue.

## First things to inspect when behavior breaks

| Symptom | First place to inspect |
|---|---|
| Login or endpoint status problems | `packages/app-server/src/auth.ts`, `packages/app-server/src/middleware.ts` |
| Topology snapshot or command issues | `packages/app-server/src/topologyProxy.ts`, `packages/app-server/src/topologySessionManager.ts` |
| Deploy/destroy/redeploy drift | `packages/app-server/src/labProxy.ts`, `packages/app-server/src/clabApiClient.ts` |
| Terminal or capture problems | `packages/app-server/src/runtimeProxy.ts`, `packages/app-server/src/terminalStreamProxy.ts`, `packages/app-server/src/captureVncStreamProxy.ts` |
| Cross-endpoint confusion | `packages/app-server/src/middleware.ts`, `packages/app-server/src/captureSessionStore.ts` |
