---
description: Embed the clab-ui topology viewer in your own website or documentation.
---

# Use clab-ui standalone

The Containerlab GUI uses `@containerlab/clab-ui` to render and edit topologies. You can also use its read-only viewer in your own website or documentation, without running a Containerlab app or connecting to an API server.

Give it a containerlab YAML file and, optionally, an annotations file for a saved layout. Readers can explore the topology without deploying the lab.

## Choose an integration

| Where you want to use it | Integration |
| --- | --- |
| A Zensical documentation site | [Markdown component](index.md): a `clab` fence creates Topology, YAML, and split views. |
| A website, with any frontend framework | [HTML component](reference.md#use-it-in-plain-html): load the static assets and add `<clab-topology>`. |
| A custom host that controls the surrounding UI | [Standalone iframe](reference.md#standalone-viewer-messages): send YAML to `viewer.html` using its message protocol. |
| A React application with one viewer | Use `mountViewer` from `@containerlab/clab-ui/viewer`. |

The iframe integrations keep every topology's styles and state independent. Use those when a page contains multiple viewers.

## Get the viewer

Install the shared UI package:

```sh
npm install @containerlab/clab-ui
```

Copy its `dist-viewer/` directory into your site's public assets. Keep the directory intact: `viewer.html`, `component.mjs`, `component.css`, and the bundled assets work together. The package also exposes these files through `@containerlab/clab-ui/viewer/static/*`.

When working in this repository, build the same assets with:

```sh
pnpm --filter @containerlab/clab-ui build:viewer
```

The result is in `packages/clab-ui/dist-viewer/`.

## Keep the lab and its layout together

The `.clab.yml` file describes the network. An optional `.clab.yml.annotations.json` file holds its layout, icons, groups, and other visual annotations. Export or save that file from the GUI to reuse the arrangement in an embed.

Without annotations, the viewer arranges the topology automatically. The YAML remains the source used for rendering, copying, and downloading the lab.

## Put it in your docs

The [Zensical integration](index.md) turns a YAML file into a diagram readers can explore. The [component reference](reference.md) covers options, theming, embedding, and messages.
