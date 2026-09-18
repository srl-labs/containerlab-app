---
description: Embed the Containerlab topology viewer in your own website or documentation.
---

# Use the standalone viewer

`@containerlab/clab-viewer` brings the Containerlab GUI's topology rendering to your own website or documentation. It bundles its browser dependencies and works without Zensical, a React application, or an API server.

Give it a containerlab YAML file and, optionally, an annotations file for a saved layout. Readers can explore the topology without deploying the lab.

## Choose an integration

| Where you want to use it | Integration |
| --- | --- |
| A Zensical documentation site | [Markdown component](index.md): a `clab` fence creates Topology, YAML, and split views. |
| A website, with any frontend framework | [HTML component](reference.md#use-it-in-plain-html): load the static assets and add `<clab-topology>`. |
| A custom host that controls the surrounding UI | [Standalone iframe](reference.md#standalone-viewer-messages): send YAML to `viewer.html` using its message protocol. |
| A JavaScript application with one viewer | Import `mountViewer` from `@containerlab/clab-viewer` and `@containerlab/clab-viewer/styles.css`. |

The iframe integrations keep every topology's styles and state independent. Use those when a page contains multiple viewers.

## Get the viewer

Install the standalone viewer package:

```sh
npm install @containerlab/clab-viewer
```

Copy its `dist/` directory into your site's public assets. Keep the directory intact: `viewer.html`, `component.mjs`, `component.css`, and the bundled assets work together. The package also exposes these files through `@containerlab/clab-viewer/static/*`.

When working in this repository, build the same assets with:

```sh
pnpm viewer
```

The result is in `packages/clab-viewer/dist/`. For an unreleased version, run `pnpm viewer:pack` and install `artifacts/clab-viewer.tgz` in the external project. Existing `@containerlab/clab-ui/viewer` integrations remain supported.

## Keep the lab and its layout together

The `.clab.yml` file describes the network. An optional `.clab.yml.annotations.json` file holds its layout, icons, groups, and other visual annotations. Export or save that file from the GUI to reuse the arrangement in an embed.

Without annotations, the viewer arranges the topology automatically. The YAML remains the source used for rendering, copying, and downloading the lab.

## Put it in your docs

The [Zensical integration](index.md) turns a YAML file into a diagram readers can explore. The [component reference](reference.md) covers options, theming, embedding, and messages.
