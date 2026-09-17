# 11. Web Route and Proxy Matrix

This page maps `containerlab-app` routes to their real behavior. It is intentionally exact, because this is where browser-hosted drift usually appears.

## Auth and endpoint-session routes

| Incoming route | Upstream mapping | Session handling | Common failure |
|---|---|---|---|
| `GET /api/config` | local only | returns saved endpoint metadata plus `defaultClabApiUrl` | wrong default API URL or stale browser session assumptions |
| `POST /auth/endpoints/add` | `POST /login` | creates a browser session if needed, stores a new endpoint entry and JWT | bad URL, bad credentials, group mismatch |
| `POST /auth/login` | `POST /login` | same login path as above, but returns a slightly richer login payload | same as above |
| `GET /auth/endpoints` | probe each endpoint with `GET /api/v1/labs/topology/files` | reads endpoint session store and reports `connected`, `session_expired`, or `offline` | endpoint offline or token expired |
| `DELETE /auth/endpoints/:id` | local only | removes one endpoint from the browser session and disposes related topology sessions | endpoint id missing or stale |
| `POST /auth/endpoints/:id/reconnect` | `POST /login` | refreshes a saved endpoint entry with new credentials | invalid credentials or missing URL |
| `PATCH /auth/endpoints/:id/preferences` | local only | updates stored endpoint preferences such as `sessionDuration` | endpoint missing |
| `PATCH /auth/endpoints/:id` | local update, then revalidation via `GET /api/v1/labs/topology/files` | updates label, URL, username, or duration | invalid URL or endpoint missing |
| `GET /auth/me` | local only | returns whether any saved endpoint is currently connected | no active browser session |
| `POST /auth/logout` | local only | clears saved endpoint entries and browser session cookie | usually safe no-op |

## Topology routes

| Incoming route | Upstream or local behavior | Important details |
|---|---|---|
| `GET /files` | `GET /api/v1/labs/topology/files` | browser-facing file list for explorer flows |
| `POST /api/topology/sessions` | local topology-session manager plus canonical topology resolution | creates a topology session bound to one saved endpoint; supports `sourcePreference` of `api-file` or `running-lab-doc` |
| `DELETE /api/topology/sessions/:sessionId` | local topology-session manager | only disposes the local topology session |
| `POST /api/topology/snapshot` | local topology session host; upstream file/doc operations as needed | if no `sessionId` is supplied, returns an empty snapshot scaffold instead of failing |
| `POST /api/topology/command` | local topology session host; upstream file/doc operations as needed | requires `sessionId` and `command`; returns topology-host ack/reject/error payloads |
| `GET /api/topology/events` | `GET /api/v1/labs/{labName}/topology/events?path=...` | requires `sessionId`; converts upstream stream into browser SSE |

## Lab lifecycle routes

| Incoming route | Upstream mapping | Notes |
|---|---|---|
| `POST /api/lab/status` | `GET /api/v1/labs/{labName}` | returns whether the target lab is currently running |
| `POST /api/lab/deploy` | `POST /api/v1/labs/{labName}/deploy?path=...&includeLogs=true` | resolves the lab from `sessionId` or `topologyRef` |
| `POST /api/lab/deploy/stream` | `POST /api/v1/labs/{labName}/deploy?stream=true&path=...` | forwards NDJSON lifecycle output |
| `POST /api/lab/destroy` | `DELETE /api/v1/labs/{labName}?cleanup=...&includeLogs=true` | supports optional cleanup |
| `POST /api/lab/destroy/stream` | `DELETE /api/v1/labs/{labName}?stream=true&cleanup=...` | forwards NDJSON lifecycle output |
| `POST /api/lab/redeploy` | `PUT /api/v1/labs/{labName}?cleanup=...&includeLogs=true` | supports optional cleanup |
| `POST /api/lab/redeploy/stream` | `PUT /api/v1/labs/{labName}?stream=true&cleanup=...` | forwards NDJSON lifecycle output |

## Runtime routes

| Incoming route | Upstream mapping | Notes |
|---|---|---|
| `GET /api/runtime/inspect/all` | `GET /api/v1/labs` | with no explicit endpoint, merges responses from every saved endpoint |
| `POST /api/runtime/inspect/lab` | `GET /api/v1/labs/{labName}` | resolves target lab from `sessionId` or `topologyRef` |
| `POST /api/runtime/save` | `POST /api/v1/labs/{labName}/save` | optional node filter is resolved from a node name first |
| `POST /api/runtime/ssh` | `POST /api/v1/labs/{labName}/nodes/{nodeName}/ssh` | optional duration and SSH username |
| `POST /api/runtime/logs` | `GET /api/v1/labs/{labName}/nodes/{nodeName}/logs?tail=...` | browser host converts node name to the real container target first |
| `POST /api/runtime/terminal-sessions` | `POST /api/v1/labs/{labName}/nodes/{nodeName}/terminal-sessions` | creates terminal session metadata only; websocket is separate |
| `GET /api/runtime/terminal-sessions/:sessionId` | `GET /api/v1/terminal-sessions/{sessionId}` | session status lookup |
| `DELETE /api/runtime/terminal-sessions/:sessionId` | `DELETE /api/v1/terminal-sessions/{sessionId}` | closes terminal session |
| `POST /api/runtime/netem/show` | `GET /api/v1/tools/netem/show?containerName=...` | browser route is POST even though upstream lookup is GET |
| `POST /api/runtime/netem/set` | `POST /api/v1/tools/netem/set` | requires `interfaceName` |
| `POST /api/runtime/netem/reset` | `POST /api/v1/tools/netem/reset` | requires `interfaceName` |
| `GET /api/runtime/version` | `GET /api/v1/version` | version info |
| `GET /api/runtime/version/check` | `GET /api/v1/version/check` | update check |
| `GET /api/runtime/ui/custom-nodes` | `GET /api/v1/ui/custom-nodes` | global custom-node templates |
| `POST /api/runtime/ui/custom-nodes` | `POST /api/v1/ui/custom-nodes` | save one custom node |
| `DELETE /api/runtime/ui/custom-nodes/:name` | `DELETE /api/v1/ui/custom-nodes/{name}` | delete one custom node |
| `POST /api/runtime/ui/custom-nodes/default` | `POST /api/v1/ui/custom-nodes/default` | set default custom node |
| `POST /api/runtime/ui/icons/list` | `GET /api/v1/labs/{labName}/ui/icons` | lab-scoped icon listing |
| `POST /api/runtime/ui/icons` | `POST /api/v1/ui/icons` | upload global icon |
| `DELETE /api/runtime/ui/icons/:iconName` | `DELETE /api/v1/ui/icons/{iconName}` | delete global icon |
| `POST /api/runtime/ui/icons/reconcile` | `POST /api/v1/labs/{labName}/ui/icons/reconcile` | remove unused lab-scoped icons |
| `POST /api/runtime/topology-file/create` | `HEAD` and `PUT` against `/api/v1/labs/{labName}/topology/file`, then `GET /api/v1/labs/topology/files` | creates a new topology file and returns a canonical `topologyRef` |
| `POST /api/runtime/topology-file/delete` | `DELETE /api/v1/labs/{labName}/topology/file?path=...` | deletes the selected topology file |

## Capture routes

| Incoming route | Upstream mapping | Notes |
|---|---|---|
| `GET /api/runtime/capture/edgeshark/status` | `GET /api/v1/tools/edgeshark/status` | status lookup |
| `POST /api/runtime/capture/edgeshark/install` | `POST /api/v1/tools/edgeshark/install` | privileged action |
| `POST /api/runtime/capture/edgeshark/uninstall` | `POST /api/v1/tools/edgeshark/uninstall` | privileged action |
| `POST /api/runtime/capture/packetflix` | `POST /api/v1/labs/{labName}/capture/packetflix` | browser host resolves capture targets first |
| `POST /api/runtime/capture/wireshark-vnc-sessions` | `POST /api/v1/labs/{labName}/capture/wireshark-vnc-sessions` | stores capture-session to endpoint mapping after creation |
| `GET /api/runtime/capture/wireshark-vnc-sessions/:sessionId/ready` | `GET /api/v1/capture/wireshark-vnc-sessions/{sessionId}/ready` | resolves endpoint by explicit request, saved capture mapping, or default session endpoint |
| `DELETE /api/runtime/capture/wireshark-vnc-sessions/:sessionId` | `DELETE /api/v1/capture/wireshark-vnc-sessions/{sessionId}` | deletes the capture session and clears local mapping |
| `POST /api/runtime/capture/wireshark-vnc-sessions/:sessionId/close` | `DELETE /api/v1/capture/wireshark-vnc-sessions/{sessionId}` | convenience alias in the browser host |
| `/api/runtime/capture/wireshark-vnc-sessions/:sessionId/vnc/*` | `/api/v1/capture/wireshark-vnc-sessions/{sessionId}/vnc/*` | HTTP asset proxy for the VNC UI |

## Streaming and websocket routes

| Route | Type | Behavior |
|---|---|---|
| `GET /api/events` | SSE | opens upstream NDJSON event stream and rewrites each line into SSE |
| `GET /api/topology/events` | SSE | opens topology-file event stream for one topology session and rewrites to SSE |
| `GET /api/runtime/terminal-sessions/:sessionId/stream` | websocket | bidirectional websocket tunnel to `/api/v1/terminal-sessions/{id}/stream` |
| `GET /api/runtime/capture/wireshark-vnc-sessions/:sessionId/vnc/websockify` | websocket | bidirectional websocket tunnel to upstream VNC websockify endpoint |
| `GET /api/runtime/capture/wireshark-vnc-sessions/:sessionId/vnc/websockify/*` | websocket | same as above, but with a suffix path |

## Frontend wiring map

| Frontend area | Main source | Route families used |
|---|---|---|
| auth bootstrap and endpoint management | `src/hooks/useAuth.ts` | `/api/config`, `/auth/*` |
| event feed | `src/hooks/useEventStream.ts` | `/api/events` |
| host and runtime assembly | `src/main.tsx` | all browser-facing route families |
| topology manager | `src/standaloneTopology.ts` | `/files`, `/api/topology/*` |
| lifecycle manager | `src/standaloneLifecycle.ts` | `/api/lab/*` |
| runtime transport helpers | `src/runtimeApi.ts` | `/api/runtime/*` |
| terminal windows | `src/components/RuntimeTerminalWindows.tsx` | terminal session routes and websocket stream |
| VNC UI | `src/wiresharkVncMain.tsx` | capture readiness, close, HTTP assets, websocket stream |

## Endpoint resolution rules

Normal request resolution uses this order:

1. explicit target information in the request body such as `endpointId` or `topologyRef.topologyId`
2. `x-endpoint-id` header or `endpointId` query parameter when a route supports them
3. the first endpoint stored in the browser session

Capture-session routes add one extra lookup:

1. explicit endpoint in the request
2. saved capture-session to endpoint mapping
3. default endpoint from the browser session

## High-signal failure signatures

| Signature | Likely class |
|---|---|
| `401` from a browser route even though the SPA looks logged in | browser session exists, but the saved endpoint token is missing or expired |
| topology snapshot or command returns `404` | stale topology session or canonical topology reference drift |
| terminal websocket closes immediately | terminal session no longer exists upstream |
| VNC ready or close route returns `404` | capture-session mapping is stale or the upstream capture session expired |
| inspect-all results look duplicated or oddly renamed | multiple endpoints were merged, and labels are being added to lab names |

## Source anchors

- `containerlab-app/packages/app-server/src/index.ts`
- `containerlab-app/packages/app-server/src/auth.ts`
- `containerlab-app/packages/app-server/src/fileProxy.ts`
- `containerlab-app/packages/app-server/src/topologyProxy.ts`
- `containerlab-app/packages/app-server/src/labProxy.ts`
- `containerlab-app/packages/app-server/src/runtimeProxy.ts`
- `containerlab-app/packages/app-server/src/eventsProxy.ts`
- `containerlab-app/packages/app-server/src/topologyEventsProxy.ts`
- `containerlab-app/packages/app-server/src/terminalStreamProxy.ts`
- `containerlab-app/packages/app-server/src/captureVncStreamProxy.ts`
