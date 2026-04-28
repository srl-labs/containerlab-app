# containerlab-web

[![GitHub releases](https://img.shields.io/github/v/release/srl-labs/containerlab-web.svg?style=flat-square&color=00c9ff&labelColor=bec8d2)](https://github.com/srl-labs/containerlab-web/releases)
[![Doc](https://img.shields.io/badge/Docs-containerlab.dev-blue?style=flat-square&color=00c9ff&labelColor=bec8d2)](https://containerlab.dev/cmd/tools/api-server/start/)
[![Bluesky](https://img.shields.io/badge/follow-containerlab-1DA1F2?logo=bluesky&style=flat-square&color=00c9ff&labelColor=bec8d2)](https://bsky.app/profile/containerlab.dev)
[![Discord](https://img.shields.io/discord/860500297297821756?style=flat-square&label=discord&logo=discord&color=00c9ff&labelColor=bec8d2)](https://discord.gg/vAyddtaEV9)

A standalone browser host for [containerlab](https://containerlab.dev/) built on top of [`@srl-labs/clab-ui`](https://github.com/srl-labs/clab-ui). It provides a web UI for exploring, opening, deploying, destroying, and redeploying containerlab topologies through a reachable `clab-api-server`.

The production image serves the web UI, authenticates against `clab-api-server`, proxies topology and lifecycle operations, and streams runtime events into the browser. `containerlab-web` does not start or manage `clab-api-server`; run that service separately.

Because the API endpoint is selected at login, one `containerlab-web` instance can be used with multiple `clab-api-server` installations. This is useful when labs are spread across different hosts, lab servers, or user environments.

![screenshot](https://raw.githubusercontent.com/srl-labs/containerlab-web/refs/heads/main/resources/screenshot.png)

---

## Quick Start

Install `clab-api-server` on the host:

```bash
curl -sL https://raw.githubusercontent.com/srl-labs/clab-api-server/main/install.sh | sudo -E bash
```

Edit `/etc/clab-api-server.env`, set at least a strong `JWT_SECRET`, and set `API_SERVER_HOST` to the hostname or IP address clients should use for API and SSH access. The API server authenticates Linux users, so users must exist on the host and belong to the configured API group.

Enable and start the service:

```bash
sudo systemctl enable --now clab-api-server
sudo systemctl status clab-api-server
```

Run the published `containerlab-web` image:

```bash
docker run --rm -p 3001:3001 \
  --add-host=host.docker.internal:host-gateway \
  -e CLAB_API_URL=https://host.docker.internal:8080 \
  ghcr.io/srl-labs/containerlab-web:latest
```

Open `https://localhost:3001`, then log in with your API credentials and endpoint. The default local certificate is self-signed, so your browser may ask you to accept it.

`CLAB_API_URL` must be reachable from inside the `containerlab-web` container. The example above uses `host.docker.internal` plus Docker's host gateway mapping so the container can reach an API server running on the Docker host.

For temporary local trials, Containerlab's `containerlab tools api-server start` command can also start the API server. For regular use, prefer the installed `clab-api-server` service.

---

## Requirements

For normal usage with the published image:

- Docker or another container runtime
- A reachable `clab-api-server` endpoint, commonly `https://localhost:8080` on the host
- Linux user credentials accepted by `clab-api-server`

Node.js and npm are only needed when developing, testing, or building from source.

---

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Web UI server port |
| `CLAB_API_URL` | `https://localhost:8080` | Default `clab-api-server` endpoint shown to the UI |
| `CLAB_API_TLS_VERIFY` | `false` | Verify upstream API TLS certificates; default allows self-signed API endpoints |
| `WEB_TLS_ENABLE` | `true` | Serve `containerlab-web` over HTTPS |
| `WEB_TLS_AUTO_CERT` | `true` | Generate/reuse a local self-signed web certificate when cert/key files are unset |
| `WEB_TLS_CERT_FILE` | unset | Path to a web TLS certificate |
| `WEB_TLS_KEY_FILE` | unset | Path to a web TLS private key |
| `VITE_DEV_URL` | `https://localhost:5173` | Vite dev server URL used in development |
| `CLAB_STANDALONE_INTERFACE_STATS_INTERVAL` | `1s` | Interface stats interval requested from the API event stream |
| `CLAB_UI_SOURCE` | unset | When set to `local`, Vite resolves `@srl-labs/clab-ui*` from `../clab-ui/dist` |
| `NODE_ENV` | `development` / `production` | Controls dev proxy mode vs static asset serving |

The login flow lets users select the API URL, so the same web UI can connect to different `clab-api-server` endpoints. The selected endpoint is stored in secure httpOnly cookies for the session.

---

## Development

Use the development workflow when contributing to this repository or building a custom image.

### Source Setup

This project requires Node.js `>= 24`, npm, and `openssl` for local HTTPS certificate generation. Installing or building from source also requires a GitHub token with GitHub Packages read access because `@srl-labs/clab-ui` is published through GitHub Packages.

```bash
export GITHUB_TOKEN=$(gh auth token)
npm install
npm run dev
```

The dev server starts the local web server and Vite frontend over HTTPS. Open `https://localhost:3001`, then log in against your running `clab-api-server`.

Useful contributor commands:

```bash
npm run build
npm run typecheck
npm run test:unit
npm run test:e2e
```

### Local Docker Build

The GHCR image is the default way to run the app. Build locally only when testing local changes:

```bash
GITHUB_TOKEN=$(gh auth token) \
  docker build --secret id=github_token,env=GITHUB_TOKEN -t containerlab-web .
```

Run the locally built image with the same environment shown in the quick start, replacing the image name with `containerlab-web`.

### Local `clab-ui` Mode

By default this repo resolves `@srl-labs/clab-ui` from the published package after `npm install`. To test unpublished UI changes, build a sibling `clab-ui` checkout first:

```bash
cd ../clab-ui
npm install
npm run build
```

Then start strict local mode from this repository:

```bash
cd ../containerlab-web
npm run dev:local
```

`dev:local` fails fast if required files are missing from `../clab-ui/dist`.

---

## Testing

Run unit tests:

```bash
npm run test:unit
```

Install the Playwright browser once per machine, then run the E2E suite:

```bash
npx playwright install chromium
npm run test:e2e
```

The Playwright config starts `npm run dev` automatically and runs tests against the Vite frontend at `https://localhost:5173`.

---

## Project Scope

This repository owns:

- the standalone browser host for the shared `@srl-labs/clab-ui` experience
- the web server used by the production image and development workflow
- standalone unit and Playwright E2E test suites
- static resources used by the standalone app

`@srl-labs/clab-ui` remains the shared package consumed by both this repo and `vscode-containerlab`.

---

## Feedback and Contributions

- **GitHub Issues:** [Create an issue](https://github.com/srl-labs/containerlab-web/issues)
- **Pull Requests:** Contributions are welcome
- **Discord:** Join the [containerlab Discord](https://discord.gg/vAyddtaEV9)
