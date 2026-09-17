# containerlab-app

This monorepo contains `containerlab-app` (web and desktop),
`vscode-containerlab`, and the shared `@containerlab/clab-ui` package.

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

Use Node.js `24.18.0` and pnpm `11.17.0` (pinned in `package.json`). Local web development also needs `openssl` for HTTPS certificates.

```sh
corepack enable
corepack pnpm install --frozen-lockfile
pnpm web:local
```

Run these commands from the monorepo root:

| Product | Build/package | Local development |
| --- | --- | --- |
| Shared UI library | `pnpm ui` | `pnpm ui:local` — UI harness with source hot reload |
| VS Code | `pnpm vsix` | `pnpm vsix:local` — same VSIX built from the working tree |
| Web | `pnpm web` | `pnpm web:local` — API-backed Vite development server |
| Desktop | `pnpm desktop` | `pnpm desktop:local` — build and launch Electron |
| Browser sandbox | `pnpm pages` | `pnpm pages:local` — local sandbox without an API server |

**Every app uses the checked-out `packages/clab-ui` workspace, including uncommitted edits.** Build/package and app development commands rebuild its public `dist/` exports first. Nothing downloads a published UI package, and no sibling checkout is needed. `vsix:local` is an explicit alias for `vsix`.

For rapid UI-only edits, use `pnpm ui:local`; its harness reads source directly and hot reloads changes. Running web/desktop/extension hosts consume built UI exports. After another UI edit, rerun their command to rebuild, or run `pnpm ui` in a second terminal and reload the host. The app commands do not watch UI source themselves.

The web development frontend is at `https://localhost:5173`; the app server also serves it through `https://localhost:3001`. Log in against your running `clab-api-server`. The standalone UI harness uses `http://127.0.0.1:5184`.

### Desktop packaging

`pnpm desktop` packages for the current platform. Select a target explicitly when needed:

```sh
pnpm desktop --linux
pnpm desktop --mac dmg --universal
pnpm desktop --win nsis --x64
pnpm desktop --dir
```

Build installers on the appropriate OS. Outputs go to `apps/desktop/release/`. Linux produces AppImage, `.deb`, and `.rpm` and needs `rpmbuild`. macOS and Windows installers are unsigned. `--dir` produces an unpacked app for local inspection. The Linux launcher uses X11/Ozone.

### VS Code extension

`pnpm vsix` writes `apps/vscode-containerlab/vscode-containerlab-<version>.vsix`. Install it with **Extensions → Install from VSIX**. For debugging, open this repository in VS Code and use **Debug Containerlab Extension**; its pre-launch task builds the local UI and extension.

For extension-only build watching after `pnpm ui`, use `pnpm --filter vscode-containerlab run build:watch`. Rebuild the UI after shared source edits.

The extension identity remains `srl-labs.vscode-containerlab`. It was imported from `srl-labs/vscode-containerlab` at commit `991ab745f26b925c072e5907adc5ec27ba06ce7e` (version `0.26.3`); its original Git history remains there.

### UI tarball and releases

`pnpm ui` builds the shared library used by the apps. `pnpm ui:pack` also builds the standalone iframe viewer and writes the complete npm package to `artifacts/clab-ui.tgz`. `pnpm test:package` validates a freshly built tarball in an isolated npm consumer.

Publishing is separate from building. See [RELEASING.md](RELEASING.md) for independent product tags, npm Trusted Publishing, GitHub Latest, and extension store secrets.

### Local Docker build

```sh
docker build -t containerlab-web .
```

This builds the checked-out workspace for your current Docker platform. Run it using the environment in the web app install section, with image name `containerlab-web`.

## Testing

```sh
pnpm check         # dependency and release-version policies
pnpm typecheck     # build UI, check policies, typecheck all workspaces
pnpm lint
pnpm test          # all unit suites and release-routing tests
pnpm test:package  # strict public API and npm tarball validation
```

Install Playwright's browser once, then select a browser suite:

```sh
pnpm exec playwright install chromium
pnpm test:ui
pnpm test:web
pnpm test:vscode
```

UI and web commands accept Playwright options, e.g. `pnpm test:ui --grep 'Canvas Interactions' --workers=2`. VS Code E2E tests require a display on Linux; use `xvfb-run -a pnpm test:vscode` if necessary.

Package-specific checks remain available through `pnpm --filter <package> run <script>`. Maintenance scripts can be invoked directly, e.g. `node scripts/run-stress-api-bff.mjs` for the API stress runner. Schema synchronization remains `pnpm sync:schema`.

---

## Workspace

```text
apps/web                      browser deployment host and Docker image entry
apps/desktop                  Electron host
apps/vscode-containerlab      VS Code extension
packages/app-server           shared Fastify BFF used by web and desktop
packages/standalone-runtime   shared standalone renderer/runtime around clab-ui
packages/app-contract         shared browser-facing DTO types
packages/clab-ui              shared publishable topology UI package
```

This repository is the `containerlab-app` monorepo and owns:

- the standalone web app host and Docker image for the shared `@containerlab/clab-ui` experience
- the Electron desktop app host and desktop package artifacts
- the VS Code extension and VSIX artifacts
- the shared `@containerlab/clab-ui` package
- the shared app server used by web and desktop
- standalone unit and Playwright E2E test suites
- static resources used by the standalone app

UI, extension, web, and desktop are independently versioned. All
three application hosts consume the local UI workspace through the root lockfile.

---

## Feedback and Contributions

- **GitHub Issues:** [Create an issue](https://github.com/srl-labs/containerlab-app/issues)
- **Pull Requests:** Contributions are welcome
- **Discord:** Join the [containerlab Discord](https://discord.gg/vAyddtaEV9)
