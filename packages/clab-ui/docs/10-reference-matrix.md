# 10. Reference Matrix

This page is the short lookup table set: commands, env vars, and file anchors.

## Workspace responsibilities and common commands

Run pnpm commands from the `containerlab-app` monorepo root.

| Component | Path | Build/package | Development |
| --- | --- | --- | --- |
| Shared UI | `packages/clab-ui` | `pnpm ui`, `pnpm ui:pack` | `pnpm ui:dev` |
| Web | `apps/web` | `pnpm web` | `pnpm web:dev` |
| Desktop | `apps/desktop` | `pnpm desktop` | `pnpm desktop:dev` |
| VS Code | `apps/vscode-containerlab` | `pnpm vsix` | VS Code F5 |
| Browser sandbox | `apps/web-public` | `pnpm pages` | `pnpm pages:dev` |
| Go API server | separate `clab-api-server` repository | `task` | `task test` |

Build and development commands use the workspace UI, rebuilding it first. `pnpm test` runs unit tests; `pnpm test:ui`, `pnpm test:web`, and `pnpm test:vscode` select browser/host suites. `pnpm test:package` validates npm consumers.

## File anchors

| Concern | File anchor |
|---|---|
| `clab-ui` export map | `clab-ui/package.json` |
| host factories and contracts | `clab-ui/src/host/index.ts`, `clab-ui/src/host/contracts.ts` |
| session client and message exports | `clab-ui/src/session/index.ts`, `clab-ui/src/session/client.ts` |
| web host bootstrap | `containerlab-app/packages/app-server/src/index.ts` |
| web route mapping | `containerlab-app/packages/app-server/src/auth.ts`, `labProxy.ts`, `runtimeProxy.ts`, `topologyProxy.ts` |
| API route map | `clab-api-server/internal/api/routes.go` |
| API auth and ownership helpers | `clab-api-server/internal/api/middleware.go`, `helpers.go` |
| VS Code activation | `vscode-containerlab/src/extension.ts` |
| VS Code topology bridge | `vscode-containerlab/src/reactTopoViewer/extension/*` |

## Environment variables worth remembering

| Variable | Scope | Notes |
|---|---|---|
| `CLAB_API_URL` | `containerlab-app` | default API endpoint URL offered by the browser host |
| `JWT_SECRET` | `clab-api-server` | must be set securely |
| `JWT_EXPIRATION` | `clab-api-server` | default bearer token lifetime |
| `API_USER_GROUP` | `clab-api-server` | default `clab_api` |
| `SUPERUSER_GROUP` | `clab-api-server` | default `clab_admins` |
| `CORS_ALLOWED_ORIGINS` | `clab-api-server` | exact-match allowlist unless `*` is used |
| `TRUSTED_PROXIES` | `clab-api-server` | proxy-awareness and URL generation |
| `GITHUB_TOKEN` | GitHub Actions | Automatic GitHub release/GHCR credentials |

Public npm installation needs no token. npm publication uses Trusted Publishing; see [RELEASING.md](https://github.com/srl-labs/containerlab-app/blob/main/RELEASING.md).

## Docs commands

From `packages/clab-ui`:

```bash
mkdocs serve -f mkdocs.yml
mkdocs build -f mkdocs.yml
```
