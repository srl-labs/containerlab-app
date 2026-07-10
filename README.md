# containerlab-app

[![Doc](https://img.shields.io/badge/Docs-containerlab.dev-blue?style=flat-square&color=00c9ff&labelColor=bec8d2)](https://containerlab.dev/cmd/tools/api-server/start/)
[![Bluesky](https://img.shields.io/badge/follow-containerlab-1DA1F2?logo=bluesky&style=flat-square&color=00c9ff&labelColor=bec8d2)](https://bsky.app/profile/containerlab.dev)
[![Discord](https://img.shields.io/discord/860500297297821756?style=flat-square&label=discord&logo=discord&color=00c9ff&labelColor=bec8d2)](https://discord.gg/vAyddtaEV9)

## Try It In Your Browser

Want to try the UI, create `*.clab.yml` files, or visualize containerlab topologies without installing anything? Open the GitHub Pages sandbox:

https://srl-labs.github.io/containerlab-app/

The sandbox runs entirely in your browser and stores its workspace in browser storage. It is meant for editing and visualization; deploying, destroying, and inspecting real labs require the web or desktop app connected to a reachable `clab-api-server`.

---

`containerlab-app` provides graphical applications for [containerlab](https://containerlab.dev/). It ships the same standalone UI in two forms:

- **Web app:** a containerized web service you open in a browser.
- **Desktop app:** an Electron app for Linux, macOS, and Windows.

Both apps connect to a reachable `clab-api-server` and use it to authenticate, list topologies, deploy labs, destroy labs, stream events, and open interactive sessions. The web and desktop apps do not start or manage `clab-api-server`; run it on the machine that owns your container runtime and lab files.

![screenshot](apps/web/resources/screenshot.png)

---

## Which App Should I Use?

| Option | Use it when | Install artifact |
| --- | --- | --- |
| Web app | You want one shared UI reachable from a browser, often on a lab server or VM. | Container image |
| Desktop app | You want a local application window on your workstation. | `.deb`, `.rpm`, AppImage, `.dmg`, or `.exe` |

Both options can connect to allowlisted local or remote `clab-api-server` endpoints. The API endpoint is selected at login, so one app installation can work with multiple lab hosts after the app operator configures their exact origins.

---

## 1. Install `clab-api-server`

Install `clab-api-server` on the Linux host where containerlab and the container runtime run:

```bash
curl -fsSL https://raw.githubusercontent.com/srl-labs/clab-api-server/main/install.sh | sudo bash -s -- install
```

This will:
- Download the binary to `/usr/local/bin/clab-api-server`
- Create a default configuration at `/etc/clab-api-server/clab-api-server.env`
- Create a systemd unit at `/etc/systemd/system/clab-api-server.service`
- Create the default Linux groups `clab_api` and `clab_admins` if they do not exist
- Generate a random `JWT_SECRET` for new installations

Review the configuration and add users to the API group before starting the service:

```bash
sudoedit /etc/clab-api-server/clab-api-server.env
sudo usermod -aG clab_api <username>
sudo systemctl enable --now clab-api-server
```

For an immediate start with the generated defaults, use `install --start`.

Authentication uses Linux/PAM accounts on the API server host, not app-local users. Each allowed user must exist on that host, sign in with their Linux password, and belong to `clab_api` or your configured `API_USER_GROUP`; `clab_admins` or `SUPERUSER_GROUP` grants elevated API permissions.

For full API server setup and security details, see the [`clab-api-server` README](https://github.com/srl-labs/clab-api-server/blob/main/README.md).

The systemd service runs as `root` because the API server controls host container runtime resources, network namespaces, Linux users, and lab files.

For temporary local trials, Containerlab's `containerlab tools api-server start` command can also start the API server. For regular use, prefer the installed service.

Topology files created through the app are stored by `clab-api-server` on the API host. By default that is the authenticated user's `~/.clab` directory. To use another server-side root, set `CLAB_LABS_ROOT=/absolute/path` in the API server configuration; files are then stored under `$CLAB_LABS_ROOT/<username>/`. For the Containerlab tools helper, use `containerlab tools api-server start --labs-dir /absolute/path`.

On macOS, run `clab-api-server` in the Linux environment that owns containerlab and the Docker daemon, such as an OrbStack VM, Docker Desktop VM, devcontainer, or a remote Linux lab host. The app then connects to that API endpoint from the browser or desktop app.

---

## 2A. Install The Web App

The web app is published as a multi-arch container image for `linux/amd64` and `linux/arm64`. The current image name is `ghcr.io/srl-labs/containerlab-web`.

The supported host deployment keeps the privilege boundary explicit:

```text
browser -> unprivileged containerlab-app container -> host clab-api-server -> host containerlab/runtime
```

`clab-api-server` must listen on an address reachable from the Docker bridge. Restrict that listener with the host firewall and TLS; it remains the component that authenticates users and owns access to containerlab, lab files, network namespaces, and the container runtime.

The repository includes a hardened bridge-network Compose deployment. It publishes the UI on loopback by default, drops every Linux capability, uses a read-only root filesystem, and persists only web TLS material and protected endpoint-session state:

```bash
docker compose up -d
```

Its default upstream URL is `https://host.docker.internal:8090`. Override values in a `.env` file when needed:

```dotenv
CLAB_API_URL=https://host.docker.internal:8090
CLAB_API_CA_FILE_HOST=/root/.config/clab-api-server/tls/localhost.pem
CLAB_API_TLS_SERVER_NAME=localhost
CLAB_API_TLS_VERIFY=true
WEB_TLS_HOST=localhost
CONTAINERLAB_APP_BIND_ADDRESS=127.0.0.1
CONTAINERLAB_APP_PORT=3001
```

The app server combines Node's bundled roots with the operating-system trust store. The Compose deployment additionally bind-mounts the host API server's default auto-generated certificate from `/root/.config/clab-api-server/tls/localhost.pem`, trusts that exact certificate, and verifies it with the `localhost` server name while routing over `host.docker.internal`. This is the default path produced when the root-managed systemd service uses `TLS_AUTO_CERT=true`. If `TLS_CERT_FILE` points elsewhere, set `CLAB_API_CA_FILE_HOST` to that certificate path. If the certificate uses another DNS name, set `CLAB_API_TLS_SERVER_NAME` to a name in its SAN list.

Before starting Compose, make the host API listener reachable from the Docker bridge. The installer intentionally defaults `API_LISTEN_ADDRESS` to loopback; change it to the Docker bridge address or another firewall-protected host address and restart `clab-api-server`. Do not expose the listener to untrusted networks.

For a custom deployment, the equivalent Compose override is:

```yaml
services:
  web:
    environment:
      CLAB_API_CA_FILE: /run/secrets/clab-api-ca.pem
      CLAB_API_TLS_SERVER_NAME: api-host.example.com
    volumes:
      - /absolute/path/to/clab-api-ca.pem:/run/secrets/clab-api-ca.pem:ro
```

The equivalent hardened `docker run` command is:

```bash
docker volume create containerlab-app-state
docker volume create containerlab-app-tls
docker run -d --name containerlab-app \
  --restart unless-stopped \
  --init \
  --add-host host.docker.internal:host-gateway \
  --publish 127.0.0.1:3001:3001 \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --mount type=volume,src=containerlab-app-tls,dst=/home/node/.config/containerlab-web/tls \
  --mount type=volume,src=containerlab-app-state,dst=/home/node/.local/state/containerlab-web \
  --mount type=bind,src=/root/.config/clab-api-server/tls/localhost.pem,dst=/run/secrets/clab-api-ca.pem,readonly \
  --env CLAB_API_URL=https://host.docker.internal:8090 \
  --env CLAB_API_LOCAL_HOST_MODE=true \
  --env CLAB_API_CA_FILE=/run/secrets/clab-api-ca.pem \
  --env CLAB_API_TLS_SERVER_NAME=localhost \
  --env CLAB_API_TLS_VERIFY=true \
  --env CONTAINERLAB_WEB_SESSION_FILE=/home/node/.local/state/containerlab-web/endpoint-sessions.json \
  --env WEB_TLS_HOST=localhost \
  ghcr.io/srl-labs/containerlab-web:latest
```

Open `https://localhost:3001`, accept the self-signed development certificate if your browser asks, and log in with an allowed Linux/PAM user from the API server host.

The configured `CLAB_API_URL` origin is always allowed. To let users add more API endpoints, the app operator must list their exact origins in `CLAB_API_ALLOWED_ORIGINS`, separated by commas. This prevents the unauthenticated login route from becoming a proxy to arbitrary host, private-network, or cloud-metadata services. `CLAB_API_LOCAL_HOST_MODE=true` additionally permits the well-known local container-host aliases, but only with the same scheme and port as `CLAB_API_URL`.

> [!CAUTION]
> Do not bind-mount the host `containerlab` binary, Docker/Podman socket, lab directories, `/proc`, `/sys`, or network namespaces into the web container. A mounted binary still runs in the container's namespaces, while a runtime-socket or privileged mount gives a web-facing process host-equivalent control. Keep those resources behind the authenticated host `clab-api-server` boundary.

If the API is intentionally bound only to host loopback, Linux `--network host` remains a compatibility fallback. It has a broader network blast radius than the bridge deployment and should be paired with the strict endpoint allowlist. No containerlab binary or runtime mount is required in either mode.

Use the provided Linux-only override to keep both the API server and web listener on host loopback:

```bash
docker compose -f compose.yaml -f compose.host-network.yaml up -d
```

The override removes published ports, uses the host network namespace, connects to `https://localhost:8090`, and sets `WEB_LISTEN_ADDRESS=127.0.0.1`. The UI is therefore reachable only from that host unless you intentionally place a trusted reverse proxy in front of it.


---

## 2B. Install The Desktop App

Download the desktop package for your platform from the GitHub release assets.

| Platform | Artifact | Install |
| --- | --- | --- |
| Debian / Ubuntu | `containerlab-desktop-<version>-amd64.deb` | `sudo apt install ./containerlab-desktop-<version>-amd64.deb` |
| Fedora / RHEL | `containerlab-desktop-<version>-x86_64.rpm` | `sudo dnf install ./containerlab-desktop-<version>-x86_64.rpm` |
| Other Linux | `containerlab-desktop-<version>-x86_64.AppImage` | `chmod +x ./containerlab-desktop-<version>-x86_64.AppImage && ./containerlab-desktop-<version>-x86_64.AppImage` |
| macOS | `containerlab-desktop-<version>-universal.dmg` | Open the DMG and move the app to Applications |
| Windows | `containerlab-desktop-<version>-x64-setup.exe` | Run the installer |

TLS verification is enabled for the desktop app. When the local root-managed
API uses its generated self-signed certificate, copy only the public
certificate to a user-readable location and launch the desktop app with it:

```bash
install -d -m 0700 "$HOME/.config/containerlab-desktop"
sudo install -m 0644 -o "$(id -u)" -g "$(id -g)" \
  /root/.config/clab-api-server/tls/localhost.pem \
  "$HOME/.config/containerlab-desktop/clab-api-ca.pem"
CLAB_API_CA_FILE="$HOME/.config/containerlab-desktop/clab-api-ca.pem" \
  containerlab-desktop
```

For a remote server, set `CLAB_API_URL` to its HTTPS origin. A CA installed in
the operating-system trust store is used automatically; otherwise provide it
through `CLAB_API_CA_FILE` before launch. `CLAB_API_TLS_VERIFY=false` is an
explicit compatibility escape hatch for an isolated loopback-only trial, not
a production default. Then log in with an allowed Linux/PAM user from the API
server host.

The macOS and Windows packages are currently unsigned. macOS Gatekeeper and Windows SmartScreen may show warnings until signing and notarization are added.

---

## Configuration

### Web App

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Web server port |
| `WEB_LISTEN_ADDRESS` | `0.0.0.0` | Web listener address; the host-network override pins this to `127.0.0.1` |
| `CLAB_API_URL` | `https://localhost:8090` | Default and implicitly allowed clab-api-server endpoint |
| `CLAB_API_ALLOWED_ORIGINS` | unset | Comma-separated additional exact API origins users may connect to |
| `CLAB_API_LOCAL_HOST_MODE` | `false` | Permit local host aliases with the default API scheme and port |
| `CLAB_API_TLS_VERIFY` | `true` in production | Verify upstream API TLS certificates; development defaults to `false` |
| `CLAB_API_CA_FILE` | unset | Additional PEM CA file appended to Node and operating-system trust roots for clab-api-server HTTP and WebSocket connections |
| `CLAB_API_TLS_SERVER_NAME` | URL hostname | Optional TLS server-name override for the configured default endpoint when its trusted certificate is reached through a container-host alias |
| `CONTAINERLAB_WEB_SESSION_FILE` | unset | Optional protected file that persists browser endpoint sessions and bearer tokens across restarts |
| `WEB_TLS_ENABLE` | `true` | Serve the web app over HTTPS |
| `WEB_TLS_AUTO_CERT` | `true` | Generate/reuse a local self-signed web certificate when cert/key files are unset |
| `WEB_TLS_CERT_FILE` | unset | Path to a web TLS certificate |
| `WEB_TLS_KEY_FILE` | unset | Path to a web TLS private key |
| `WEB_TLS_HOST` | auto-detected | Stable browser access name used when generating a local certificate; set it for containers so certificate reuse does not depend on an ephemeral container hostname |
| `CLAB_STANDALONE_INTERFACE_STATS_INTERVAL` | `1s` | Interface stats interval requested from the API event stream |

### Desktop App

| Variable | Default | Description |
| --- | --- | --- |
| `CLAB_API_URL` | `https://localhost:8090` | Default and implicitly allowed clab-api-server endpoint |
| `CLAB_API_ALLOWED_ORIGINS` | unset | Comma-separated additional exact API origins users may connect to |
| `CLAB_API_LOCAL_HOST_MODE` | `false` | Permit local host aliases with the default API scheme and port |
| `CLAB_API_TLS_VERIFY` | `true` | Verify upstream API TLS certificates |
| `CLAB_API_CA_FILE` | unset | Additional PEM CA file used only for clab-api-server connections |
| `CLAB_API_TLS_SERVER_NAME` | URL hostname | Optional TLS server-name override for the configured default endpoint |
| `CONTAINERLAB_DESKTOP_PORT` | `32180` | Preferred local loopback port for the embedded app server |
| `CONTAINERLAB_DESKTOP_DEBUG` | unset | Enable desktop app-server debug logging |

`CONTAINERLAB_WEB_SESSION_FILE` contains live upstream bearer tokens and is written with mode `0600`. Mount it only on storage trusted at the same level as the logged-in API users. Leave it unset for intentionally ephemeral browser sessions.

### Health Endpoints

| Endpoint | Meaning |
| --- | --- |
| `GET /api/health/live` | The web process is serving requests; used by the container health check |
| `GET /api/health/ready` | The configured default clab-api-server answered its public health probe; returns `503` when unavailable |

---

## Development

Use the development workflow when contributing to this repository, building a custom web image, or packaging the desktop app.

This project requires Node.js `>= 24`, npm, and `openssl` for local HTTPS certificate generation. Installing or building from source also requires a GitHub token with GitHub Packages read access because `@srl-labs/clab-ui` is published through GitHub Packages. Building Linux desktop packages locally also requires `rpmbuild` for the `.rpm` artifact.

```bash
export GITHUB_TOKEN=$(gh auth token)
npm install
npm run dev:web
```

The dev server starts the local web server and Vite frontend over HTTPS. Open `https://localhost:3001`, then log in against your running `clab-api-server`.

Useful contributor commands:

```bash
npm run build:web
npm run build:desktop
npm run package:desktop
npm run package:desktop:linux
npm run package:desktop:mac
npm run package:desktop:win
npm run typecheck
npm run test:unit
npm run test:e2e:web
```

Run the Electron host locally after building the web assets:

```bash
npm run dev:desktop
```

On Linux, the desktop launcher forces Electron onto the X11/Ozone backend so it starts reliably under Ubuntu Wayland sessions. `npm run package:desktop` builds the Linux desktop artifacts by default: AppImage, `.deb`, and `.rpm`. All desktop package outputs are written to `apps/desktop/release/`.

macOS packaging is built with `npm run package:desktop:mac` and produces an unsigned universal `.dmg`. Windows packaging is built with `npm run package:desktop:win` and produces an unsigned NSIS `.exe` installer. Version tag builds (`v*.*.*`) publish the AppImage, `.deb`, `.rpm`, `.dmg`, and `.exe` files as GitHub release assets.

Before creating a release tag, keep the root package version, workspace package versions, internal workspace dependency versions, and `package-lock.json` aligned with the tag without the leading `v`. CI runs `npm run check:release-version`, so a tag such as `v0.0.2` requires package version `0.0.2`.

### Local Docker Build

The GHCR image is the default way to run the web app and is published for `linux/amd64` and `linux/arm64`. Build a local image only when testing local changes; the command below builds for your current Docker platform:

```bash
GITHUB_TOKEN=$(gh auth token) \
  docker build --secret id=github_token,env=GITHUB_TOKEN -t containerlab-web .
```

Run the locally built image with the same environment shown in the web app install section, replacing the image name with `containerlab-web`.

### Local `clab-ui` Mode

By default this repository resolves `@srl-labs/clab-ui` from the published package after `npm install`. To test unpublished UI changes, build a sibling `clab-ui` checkout first:

```bash
cd ../clab-ui
npm install
npm run build
```

Then start strict local mode from this repository:

```bash
cd ../containerlab-app
npm run dev:web:local
```

`dev:web:local` fails fast if required files are missing from `../clab-ui/dist`.

---

## Testing

Run unit tests:

```bash
npm run test:unit
```

Install the Playwright browser once per machine, then run the E2E suite:

```bash
npx playwright install chromium
npm run test:e2e:web
```

The Playwright config starts `npm run dev` automatically and runs tests against the Vite frontend at `https://localhost:5173`.

---

## Workspace

```text
apps/web                      browser deployment host and Docker image entry
apps/desktop                  Electron host
packages/app-server           shared Fastify BFF used by web and desktop
packages/standalone-runtime   shared standalone renderer/runtime around clab-ui
packages/app-contract         shared browser-facing DTO types
```

This repository is the `containerlab-app` monorepo and owns:

- the standalone web app host and Docker image for the shared `@srl-labs/clab-ui` experience
- the Electron desktop app host and desktop package artifacts
- the shared app server used by web and desktop
- standalone unit and Playwright E2E test suites
- static resources used by the standalone app

`@srl-labs/clab-ui` remains the shared UI package consumed by this repo and `vscode-containerlab`.

---

## Feedback and Contributions

- **GitHub Issues:** [Create an issue](https://github.com/srl-labs/containerlab-app/issues)
- **Pull Requests:** Contributions are welcome
- **Discord:** Join the [containerlab Discord](https://discord.gg/vAyddtaEV9)
