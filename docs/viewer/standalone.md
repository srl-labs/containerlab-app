---
description: Embed the containerlab topology viewer in your own website or documentation.
---

# Embed the viewer

`@containerlab/clab-viewer` renders a `.clab.yml` file the way the apps do, on any web page. No React app, no API server, no deployed lab.
{ .lead }

Every diagram on this site is the viewer. Give it a topology file, and optionally its annotations file for a saved layout:

```clab title="Hello, network" view="split" height="300"
name: hello
topology:
  defaults:
    kind: linux
    image: alpine:3.23
  nodes:
    client: {}
    server: {}
  links:
    - endpoints: [client:eth1, server:eth1]
```

## Pick an integration

| Your site | Use |
| --- | --- |
| Zensical docs | A [`clab` Markdown fence](index.md). Write the fence, get the topology, the YAML, and a split view. |
| Any website | The [`<clab-topology>` element](reference.md#use-it-in-plain-html). Load two static files and add the tag. |
| Your own UI around it | The [iframe protocol](reference.md#standalone-viewer-messages). Post YAML to `viewer.html`. |
| A JavaScript app with one viewer | `mountViewer` from `@containerlab/clab-viewer`, plus `@containerlab/clab-viewer/styles.css`. |

The element and the iframe isolate each diagram's styles and state. Use one of them when a page has several diagrams.

## Get the files

```sh
npm install @containerlab/clab-viewer
```

Copy the package's `dist/` directory into your site's static assets and keep it whole: `viewer.html`, `component.mjs`, `component.css`, and the bundled chunks belong together. They are also exported as `@containerlab/clab-viewer/static/*`.

To build from this repository, run `pnpm viewer`; the output lands in `packages/clab-viewer/dist/`. `pnpm viewer:pack` creates `artifacts/clab-viewer.tgz` for testing an unreleased version elsewhere. The older `@containerlab/clab-ui/viewer` entry point still works.

## Layouts

Without annotations, the viewer lays out the topology on its own. To keep a layout you arranged in the app, ship the `.clab.yml.annotations.json` file next to the YAML. The YAML stays the source for rendering, copying, and downloading.

<div class="next" markdown>
[:lucide-arrow-right: Use it in Zensical](index.md)
[:lucide-arrow-right: Style it in the studio](customize.md)
[:lucide-arrow-right: Component reference](reference.md)
</div>
