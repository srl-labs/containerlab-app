# Contributing to the docs

The documentation lives in `docs/` and builds with Zensical. It shares the standalone viewer with the apps, so improvements to topology rendering are available in the docs too.

## Local development

Install the repository's pinned Node and pnpm versions, Python 3.11 or newer, and [uv](https://docs.astral.sh/uv/). Then, from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run docs
```

The command builds the viewer, copies its static assets into the documentation, installs the locked Python dependencies, and starts Zensical. Edit Markdown, CSS, or templates and the preview reloads. After changing viewer code, restart `pnpm run docs` to rebuild the viewer bundle.

`docs/examples/` is explicitly watched so edits to referenced YAML and annotations also rebuild their documentation pages. Add another watch path in `zensical.toml` if you store examples elsewhere.

## Build and test

```sh
pnpm docs:build
pnpm exec playwright install chromium
pnpm docs:test
pnpm docs:perf
```

The build produces `site/`. The tests exercise Markdown validation and the built site in Chromium, including multiple viewers, tabs, source inspection, theme changes, downloads, mobile layout, and instant navigation.

Run the performance check on its own so other builds or browser tests do not compete for CPU. It checks three cold starts per profile with a 10 Mbps connection and 40 ms latency: the whole page and viewer at normal CPU speed, then viewer startup under 4× CPU slowdown. The viewer build also rejects editor dependencies in the initial bundle and enforces size limits.

## Add an example

Keep the deployable YAML in `docs/examples/`. Use an optional annotations JSON file for layout, then reference both from a `clab` fence. Include prerequisites and be explicit about whether a topology includes device configuration or only physical links.

The same file feeds the topology, YAML view, copy button, and download. There is no separate diagram asset to maintain.

## Publishing

The GitHub Pages workflow builds both the browser sandbox and documentation. The sandbox remains at `/containerlab-app/`; these docs live at `/containerlab-app/docs/`.

Pull requests from this repository deploy a combined Cloudflare Pages preview after the required PR checks pass. Documentation opens at `/`, and the sandbox from the same commit is available at `/sandbox/`. The existing PR preview comment links to both. Fork pull requests still build and test the docs without deploying them.

Run `pnpm preview:build` and `pnpm preview:test` to build and check that combined site locally. The build produces `site/` and changes sandbox links in the generated docs to `/sandbox/`. CI sets `PREVIEW_SITE_URL` to the commit's Cloudflare branch URL; the local default is `http://127.0.0.1:8011/`.

The initial app guides and screenshots came from the containerlab repository. See [documentation sources](SOURCES.md) for provenance. The core CLI and node-kind reference stays on [containerlab.dev](https://containerlab.dev/).
