# Contributing

This repository contains the Containerlab web app, desktop app, VS Code extension, and shared UI. For installation and everyday use, see the [README](README.md).

## Set up your environment

Use Node.js `24.21.0` and pnpm `12.4.2` (pinned in `package.json`). Local web development also needs `openssl` for HTTPS certificates.

Builds and typechecks use TypeScript 7. The dependency catalog is shared across all hosts;
Node type declarations follow the Node 24 LTS runtime.
VS Code API types stay on 1.105 to match the extension's minimum and support editor forks.
Monaco remains on 0.55.1 until the YAML worker supports the export paths introduced in 0.56.

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

This builds the checked-out workspace for your current Docker platform. Follow the [web app setup](README.md#web-app), replacing `ghcr.io/srl-labs/containerlab-web:latest` with `containerlab-web`.

## Testing

```sh
pnpm check         # dependency and release-version policies
pnpm typecheck     # build UI, check policies, typecheck all workspaces
pnpm lint
pnpm knip          # unused files, exports, types, and dependencies across workspaces
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

Knip also runs as part of `pnpm lint` and PR checks. Its configuration in
`knip.config.ts` includes browser, extension, test, and maintenance entry points.
Public library entry points and source aliases follow the `clab-ui` export map;
those public exports are retained for external consumers. Add new independently
launched entry points to the relevant workspace configuration. Review unused
exports before deleting implementations: a function may still be used inside its
own module and only need its `export` removed.

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
