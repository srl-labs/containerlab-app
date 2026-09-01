# 10. Reference Matrix

This page is the short lookup table set: commands, env vars, and file anchors.

## Repo responsibilities and common commands

| Repo | Primary role | Commands you will use most |
|---|---|---|
| `clab-ui` | shared publishable UI package | `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run pack:preview` |
| `clab-api-server` | authenticated API and runtime authority | `task`, `task test` |
| `containerlab-app` | browser host and Fastify gateway | `npm run dev:web`, `npm run dev:web:local`, `npm run build`, `npm run test:unit`, `npm run test:e2e:web` |
| `vscode-containerlab` | extension host and webviews | `npm run lint`, `npm test`, `npm run package`, `npm run build:local-ui`, `npm run package:local-ui` |

## Which repo to open first

| Problem area | First repo to inspect |
|---|---|
| export breakage or host contract drift | `clab-ui` |
| browser login, route, stream, or topology session drift | `containerlab-app` |
| auth, ownership, capture, or runtime policy | `clab-api-server` |
| VS Code command routing or webview updates | `vscode-containerlab` |

## Local development variants

| Consumer | Normal mode | Local shared-package mode |
|---|---|---|
| `containerlab-app` | `npm run dev:web` | `npm run dev:web:local` |
| `vscode-containerlab` | `npm run build` or `npm run package` | `npm run build:local-ui` or `npm run package:local-ui` |

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
| VS Code local-ui aliasing | `vscode-containerlab/esbuild.config.js` |

## Environment variables worth remembering

| Variable | Scope | Notes |
|---|---|---|
| `CLAB_UI_SOURCE=local` | web and VS Code consumers | tells build tooling to resolve the sibling `../clab-ui/dist` tree |
| `CLAB_API_URL` | `containerlab-app` | default API endpoint URL offered by the browser host |
| `JWT_SECRET` | `clab-api-server` | must be set securely |
| `JWT_EXPIRATION` | `clab-api-server` | default bearer token lifetime |
| `API_USER_GROUP` | `clab-api-server` | default `clab_api` |
| `SUPERUSER_GROUP` | `clab-api-server` | default `clab_admins` |
| `CORS_ALLOWED_ORIGINS` | `clab-api-server` | exact-match allowlist unless `*` is used |
| `TRUSTED_PROXIES` | `clab-api-server` | proxy-awareness and URL generation |
| `GITHUB_TOKEN` | npm install flows | GitHub Packages auth for consumers |
| `NODE_AUTH_TOKEN` | publish workflow | GitHub Packages auth for publishing |

## Docs commands

From the `clab-ui` repo:

```bash
mkdocs serve -f mkdocs.yml
mkdocs build -f mkdocs.yml
```
