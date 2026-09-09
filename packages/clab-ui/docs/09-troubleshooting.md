# 9. Troubleshooting

Use this page for first-pass triage before diving into the deeper route and contract references.

## Symptom matrix

| Symptom | Likely cause | First place to inspect |
|---|---|---|
| Browser UI loads but runtime actions fail | web gateway route or endpoint-session mismatch | `containerlab-app/packages/app-server/src/*.ts`, especially `middleware.ts` and `runtimeProxy.ts` |
| Browser requests return auth or CORS errors | missing endpoint session, invalid bearer token, or CORS mismatch | `containerlab-app/packages/app-server/src/auth.ts`, `clab-api-server/internal/api/middleware.go` |
| API returns `404` for a resource that "should" exist | ownership concealment or stale topology reference | `clab-api-server/internal/api/helpers.go`, web topology/session state |
| Terminal or VNC closes immediately | stale runtime session or capture-session mapping | `containerlab-app/packages/app-server/src/terminalStreamProxy.ts`, `captureVncStreamProxy.ts` |
| VS Code webview action does nothing | message router or command mapping drift | `vscode-containerlab/src/reactTopoViewer/extension/panel/MessageRouter.ts`, `src/extension.ts` |
| Local `clab-ui` change does not show up in a consumer | stale `dist/` or consumer not using local-ui mode | rebuild `clab-ui`, then restart the consumer |

## Fast triage order

1. Confirm which host path you are on: browser or VS Code.
2. Confirm the shared package build is current if you are testing local changes.
3. Confirm the host-specific bridge works.
4. Confirm auth and ownership behavior.
5. Confirm runtime privileges and tooling.

## Quick checks for the browser host

```bash
cd /home/flschwar/projects/clab/containerlab-app
npm run dev:web
```

Then verify:

- `GET /api/config` returns a sane default API URL and current endpoint list
- `GET /auth/me` reflects the expected browser session state
- the endpoint you think is active is actually the endpoint being used
- topology-session ids are current if the failure is topology-specific

## Quick checks for the local shared package flow

```bash
cd /home/flschwar/projects/clab/clab-ui
npm run build
```

Then restart the relevant consumer:

```bash
cd /home/flschwar/projects/clab/containerlab-app
npm run dev:web:local

cd /home/flschwar/projects/clab/vscode-containerlab
npm run build:local-ui
```

## How to read `401`, `403`, and `404`

!!! info "Status-code shortcut"
    - `401`: authentication failed
    - `403`: authentication succeeded but policy denied the action
    - `404`: resource missing or intentionally hidden by ownership rules

If you see repeated `404`s on resources that you believe exist, do not assume the route is wrong immediately. Ownership concealment is a normal API behavior in this platform.

## When to escalate into the deep references

- Use [11. Web Route and Proxy Matrix](11-web-route-and-proxy-matrix.md) when you need exact browser-route behavior.
- Use [12. API Endpoint Taxonomy](12-api-endpoint-taxonomy.md) when you need exact API families and policy expectations.
- Use [13. VS Code Bridge Contract](13-vscode-bridge-contract.md) and [14. clab-ui Contract Spec](14-clab-ui-contract-spec.md) when you suspect contract drift.
