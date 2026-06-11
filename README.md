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

Both options can connect to local or remote `clab-api-server` endpoints. The API endpoint is selected at login, so one app installation can work with multiple lab hosts.

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

Start the web app:

```bash
docker run -d --name containerlab-app \
  --restart unless-stopped \
  --network host \
  ghcr.io/srl-labs/containerlab-web:latest
```

Open `https://localhost:3001`, accept the self-signed development certificate if your browser asks, and log in with an allowed Linux/PAM user from the API server host.

The web app can connect to multiple `clab-api-server` endpoints. If the API server runs on the same host, use the default `https://localhost:8090` endpoint. For remote lab hosts, enter their DNS name or IP address, for example `https://lab-host.example.com:8090`.


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

Launch the desktop app, enter the `clab-api-server` URL, and log in with an allowed Linux/PAM user from the API server host.

The macOS and Windows packages are currently unsigned. macOS Gatekeeper and Windows SmartScreen may show warnings until signing and notarization are added.

---

## Configuration

### Web App

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | Web server port |
| `CLAB_API_TLS_VERIFY` | `false` | Verify upstream API TLS certificates |
| `WEB_TLS_ENABLE` | `true` | Serve the web app over HTTPS |
| `WEB_TLS_AUTO_CERT` | `true` | Generate/reuse a local self-signed web certificate when cert/key files are unset |
| `WEB_TLS_CERT_FILE` | unset | Path to a web TLS certificate |
| `WEB_TLS_KEY_FILE` | unset | Path to a web TLS private key |
| `WEB_TLS_HOST` | auto-detected | Hostname used when generating a local certificate |
| `CLAB_STANDALONE_INTERFACE_STATS_INTERVAL` | `1s` | Interface stats interval requested from the API event stream |

### Desktop App

| Variable | Default | Description |
| --- | --- | --- |
| `CLAB_API_TLS_VERIFY` | `false` | Verify upstream API TLS certificates |
| `CONTAINERLAB_DESKTOP_PORT` | `32180` | Preferred local loopback port for the embedded app server |
| `CONTAINERLAB_DESKTOP_DEBUG` | unset | Enable desktop app-server debug logging |

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
