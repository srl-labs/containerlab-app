# Containerlab topology viewer

`@containerlab/clab-viewer` embeds interactive containerlab topologies in any website. It accepts lab YAML and optional annotations for saved positions, icons, groups, and notes. Readers can pan, zoom, inspect nodes, and download the source without connecting to a Containerlab server.

The package bundles its browser dependencies, including React. It has no runtime or peer dependencies and works with plain HTML, any frontend framework, or a static documentation site. Zensical is an optional Markdown integration.

```sh
npm install @containerlab/clab-viewer
```

For an unreleased build, run `pnpm viewer:pack` in this repository and install the resulting `artifacts/clab-viewer.tgz` in your project.

## Plain HTML and multiple diagrams

Copy the package's entire `dist/` directory to your site's public `viewer/` directory and serve it over HTTP(S). Keep the files together: the component resolves `viewer.html` and its assets relative to its own URL.

```html
<link rel="stylesheet" href="/viewer/component.css">
<script type="module" src="/viewer/component.mjs"></script>

<clab-topology title="My lab" filename="lab.clab.yml" view="split">
  <pre>name: hello
topology:
  defaults:
    kind: linux
    image: alpine:3.23
  nodes:
    client: {}
    server: {}
  links:
    - endpoints: [client:eth1, server:eth1]</pre>
</clab-topology>
```

Each component owns an isolated iframe and includes Topology, YAML, and split views, source inspection, copy/download, and fullscreen controls. Use `theme="light"` or `theme="dark"` to fix a theme; otherwise it follows the system preference. `borderless` displays only the canvas. HTML-escape YAML when generating markup; for JavaScript-created elements, assign the source through `pre.textContent`.

Pass saved annotations as a JSON string in the `annotations` attribute. Attributes are read when the element connects: replace the element to change its topology or options. Removing it disposes its iframe and listeners. This is the supported integration for multiple independent diagrams on one page.

Static files are also addressable through `@containerlab/clab-viewer/static/*`, for example `require.resolve("@containerlab/clab-viewer/static/viewer.html")` in a build script. Copy the full directory rather than bundling `component.mjs` on its own.

## JavaScript API

A bundler can import the canvas directly. Give the container a height and import the stylesheet:

```ts
import { mountViewer } from "@containerlab/clab-viewer";
import "@containerlab/clab-viewer/styles.css";

const container = document.querySelector<HTMLElement>("#topology")!;
container.style.height = "500px";
const yaml = await fetch("/labs/demo.clab.yml").then(response => response.text());

const viewer = mountViewer(container, {
  yaml,
  theme: "light",
  viewerOptions: {
    background: "dots",
    onNodeSelect: id => console.log("Selected node:", id)
  },
  onReady: ({ nodes, links }) => console.log(nodes.length, links),
  onError: error => console.error(error)
});

// On page/component cleanup, before removing the container:
viewer.unmount();
```

The API mounts a read-only canvas without the HTML component's surrounding toolbar or source pane. `annotations` accepts raw annotations JSON. `borderless` enables a transparent canvas preset. `viewerOptions` controls labels, grid, zoom, pan, fit padding, and appearance. All public TypeScript types ship with the package.

Call `mountViewer` in the browser after the container exists, such as in a React effect, and call `unmount` during cleanup. Direct mounts share stores within one module instance, so use one direct mount at a time or the HTML component for multiple diagrams. To replace a directly mounted topology, unmount it before mounting the next one.

## Shared implementation and compatibility

The viewer and `@containerlab/clab-ui` compile the same topology parser and renderers. This package bundles those sources at build time and publishes only its viewer assets and portable declarations. Updating shared nodes, edges, or annotations therefore updates both products without copying implementations.

Existing `@containerlab/clab-ui/viewer` and `/viewer/static/*` exports remain available for compatibility. New standalone integrations can use this smaller, independently released package. Its release tags are `clab-viewer-v<version>`.

From this repository, `pnpm viewer` builds the package and `pnpm test:viewer-package` validates its tarball in an isolated npm project and Chromium. See the [embedding reference](https://srl-labs.github.io/containerlab-app/docs/viewer/reference/) for HTML attributes and the iframe message protocol.
