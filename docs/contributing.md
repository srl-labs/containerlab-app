# Contributing to the docs

The documentation lives in `docs/` and builds with Zensical. It shares the standalone viewer with the apps, so improvements to topology rendering are available in the docs too.

## Local development

Install the repository's pinned Node and pnpm versions, Python 3.11 or newer, and [uv](https://docs.astral.sh/uv/). Then, from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm docs
```

The command builds the viewer, copies its static assets into the documentation, installs the locked Python dependencies, and starts Zensical. Edit Markdown, CSS, or templates and the preview reloads. After changing viewer code, restart `pnpm docs` to rebuild the viewer bundle.

`docs/examples/` is explicitly watched so edits to referenced YAML and annotations also rebuild their documentation pages. Add another watch path in `zensical.toml` if you store examples elsewhere.

## Build and test

```sh
pnpm docs:build
pnpm exec playwright install chromium
pnpm docs:test
```

The build produces `site/`. The tests exercise Markdown validation and the built site in Chromium, including multiple viewers, tabs, source inspection, theme changes, downloads, mobile layout, and instant navigation.

## Add an example

Keep the deployable YAML in `docs/examples/`. Use an optional annotations JSON file for layout, then reference both from a `clab` fence. Include prerequisites and be explicit about whether a topology includes device configuration or only physical links.

The same file feeds the topology, YAML view, copy button, and download. There is no separate diagram asset to maintain.

## Publishing

The existing GitHub Pages workflow builds both the browser sandbox and documentation. The sandbox remains at `/containerlab-app/`; these docs live at `/containerlab-app/docs/`. Pull requests build and test the docs without deploying them.

The initial app guides and screenshots came from the containerlab repository. See [documentation sources](SOURCES.md) for provenance. The core CLI and node-kind reference stays on [containerlab.dev](https://containerlab.dev/).
