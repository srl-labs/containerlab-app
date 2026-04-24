# containerlab-web

[![GitHub releases](https://img.shields.io/github/v/release/srl-labs/containerlab-web.svg?style=flat-square&color=00c9ff&labelColor=bec8d2)](https://github.com/srl-labs/containerlab-web/releases)
[![Doc](https://img.shields.io/badge/Docs-containerlab.dev-blue?style=flat-square&color=00c9ff&labelColor=bec8d2)](https://containerlab.dev/cmd/tools/api-server/start/)
[![Bluesky](https://img.shields.io/badge/follow-containerlab-1DA1F2?logo=bluesky&style=flat-square&color=00c9ff&labelColor=bec8d2)](https://bsky.app/profile/containerlab.dev)
[![Discord](https://img.shields.io/discord/860500297297821756?style=flat-square&label=discord&logo=discord&color=00c9ff&labelColor=bec8d2)](https://discord.gg/vAyddtaEV9)

A standalone browser host for [containerlab](https://containerlab.dev/) built on top of [`@srl-labs/clab-ui`](https://github.com/srl-labs/clab-ui). It provides a Vite frontend plus a Fastify backend that authenticates against `clab-api-server`, proxies topology and lifecycle operations, and streams runtime events into the UI.

![screenshot](https://raw.githubusercontent.com/srl-labs/containerlab-web/refs/heads/main/resources/screenshot.png)

---

## Key Features

- **Standalone TopoViewer Runtime:**
  Runs the shared `@srl-labs/clab-ui` experience directly in the browser without VS Code.

- **Login + API Endpoint Selection:**
  Authenticate against `clab-api-server` and choose the API URL from the login flow (persisted in secure httpOnly cookies).

- **Live Explorer (Running / Local / Help):**
  Shows deployed labs, local topology files, and quick links. Supports actions like open in TopoViewer, deploy, destroy, and redeploy.

- **Real-Time Lab and Interface Updates:**
  Bridges `clab-api-server` NDJSON streams to browser SSE, including interface state and stats updates.

- **Session-Based Topology Editing:**
  Uses topology sessions with deployed/undeployed mode handling and refreshes when external topology document updates are detected.

- **Lifecycle Command Integration:**
  Deploy, destroy, and redeploy commands are proxied through the backend with streamed logs and cancellation support.

- **Export Support:**
  Supports SVG export flows from the shared UI in standalone mode.

---

## Requirements

- **Node.js** `>= 24` (see `.nvmrc`)
- **npm**
- A reachable **clab-api-server** (default: `http://localhost:8080`)
- **GitHub token** with GitHub Packages read access (`@srl-labs/clab-ui`)
- (Optional) **Playwright Chromium** for E2E tests

---

## Getting Started

1. Export a GitHub token so npm can fetch the shared UI package:

   ```bash
   export GITHUB_TOKEN=$(gh auth token)
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Make sure `clab-api-server` is running (for example):

   ```bash
   containerlab tools api-server start
   ```

4. Start the standalone app:

   ```bash
   npm run dev
   ```

5. Open `http://localhost:3000`, then log in with your API credentials and endpoint.

---

## Common Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start backend + Vite frontend in development mode |
| `npm run dev:local` | Start dev mode with strict local `../clab-ui/dist` resolution |
| `npm run build` | Build client bundle and backend server |
| `npm run build:server` | Build backend server only (`dist/server/index.cjs`) |
| `npm run start` | Start the built production backend |
| `npm run preview` | Preview the built Vite frontend |
| `npm run typecheck` | Typecheck client and server TypeScript |
| `npm run typecheck:local-ui` | Typecheck against local `../clab-ui/dist` declarations |
| `npm run test:unit` | Run unit tests for `src/` and `server/` |
| `npm run test:e2e` | Run Playwright E2E tests |
| `npm run test:e2e:ui` | Run Playwright in UI mode |
| `npm run test:e2e:debug` | Run Playwright in debug mode |

---

## Container Image

The published image runs the production Fastify server and serves the built
frontend from the same process. It does not run `clab-api-server`; point
`CLAB_API_URL` at a reachable API endpoint.

Run the latest image from GHCR:

```bash
docker run --rm -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e CLAB_API_URL=http://host.docker.internal:8080 \
  ghcr.io/srl-labs/containerlab-web:latest
```

Open `http://localhost:3000`, then log in with your API credentials.

Build the image locally:

```bash
GITHUB_TOKEN=$(gh auth token) \
  docker build --secret id=github_token,env=GITHUB_TOKEN -t containerlab-web .
```

Run the local image:

```bash
docker run --rm -p 3000:3000 \
  --add-host=host.docker.internal:host-gateway \
  -e CLAB_API_URL=http://host.docker.internal:8080 \
  containerlab-web
```

For Docker Compose or Kubernetes, use the service DNS name instead:

```bash
CLAB_API_URL=http://clab-api-server:8080
```

---

## Local `clab-ui` Mode

By default this repo resolves `@srl-labs/clab-ui` from the published package after `npm install`.

For local unpublished UI changes, build the sibling checkout first:

```bash
cd ../clab-ui
npm install
npm run build
```

Then start strict local mode:

```bash
cd ../containerlab-web
npm run dev:local
```

`dev:local` fails fast if required files are missing from `../clab-ui/dist`.

---

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Fastify server port |
| `CLAB_API_URL` | `http://localhost:8080` | Default `clab-api-server` endpoint |
| `VITE_DEV_URL` | `http://localhost:5173` | Vite dev server URL used by backend proxy |
| `CLAB_STANDALONE_INTERFACE_STATS_INTERVAL` | `1s` | Interface stats interval requested from API event stream |
| `CLAB_UI_SOURCE` | unset | When set to `local`, Vite resolves `@srl-labs/clab-ui*` from `../clab-ui/dist` |
| `NODE_ENV` | `development` / `production` | Controls dev proxy mode vs static asset serving |

---

## Running Tests

### Unit Tests

```bash
npm run test:unit
```

### E2E Tests

Install Playwright browser (once per machine):

```bash
npx playwright install chromium
```

Run the suite:

```bash
npm run test:e2e
```

The Playwright config starts `npm run dev` automatically and runs tests against the Vite frontend (`http://localhost:5173`).

---

## Repository Scope

This repository owns:

- the Vite frontend host
- the Fastify backend proxy
- standalone unit and Playwright E2E test suites
- static resources and the bundled schema used by the standalone app

`@srl-labs/clab-ui` remains the shared package consumed by both this repo and `vscode-containerlab`.

---

## Feedback and Contributions

- **GitHub Issues:** [Create an issue](https://github.com/srl-labs/containerlab-web/issues)
- **Pull Requests:** Contributions are welcome
- **Discord:** Join the [containerlab Discord](https://discord.gg/vAyddtaEV9)
