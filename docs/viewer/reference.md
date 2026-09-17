# Component reference

## Markdown options

Use a `clab` code fence at the top level of a Markdown page. Option values containing spaces must be quoted.

| Option | Default | Purpose |
| --- | --- | --- |
| `title` | Lab name from YAML | Accessible example title |
| `file` | Inline fence content | YAML file relative to `docs/` |
| `annotations` | Automatic layout | Annotations JSON file relative to `docs/` |
| `view` | `topology` | `topology`, `yaml`, or `split` |
| `borderless` | `false` | Canvas-only preset: removes the frame, surrounding panels, grid, and zoom buttons; makes the canvas transparent. Individual options below override the preset. |
| `heading`, `toolbar`, `inspector`, `footer` | `true`, or `false` when borderless | Show or hide each surrounding panel independently |
| `controls` | `true`, or `false` when borderless | Canvas zoom and fit buttons |
| `grid` | `dots`, or `none` when borderless | `dots`, `lines`, or `none` |
| `transparent` | Same as `borderless` | Let the page background show through the canvas |
| `theme` | `auto` | `auto`, `light`, or `dark`; auto follows the docs theme or the system preference on other sites |
| `node-labels` | `true` | Show device names |
| `link-labels` | Saved annotations, otherwise `show-all` | Interface labels: `show-all`, `on-select`, or `hide` |
| `zoom`, `pan` | `true` | Enable wheel/pinch zoom and dragging the canvas independently. Use `zoom="false"` to let the page scroll over the diagram. |
| `fit-padding` | `0.25` | Space around the fitted graph, from `0` to `2` |
| `loading` | `lazy` | Start near the viewport; use `eager` for the main diagram at the top of a page |
| `height` | `460` | Panel height in pixels, from 240 to 1000 |
| `filename` | File basename or `topology.clab.yml` | Name used when downloading |

A file reference and inline YAML cannot be combined. Missing files, malformed YAML, unknown options, and invalid annotations fail the docs build instead of silently leaving a broken example.

Boolean options accept `true` or `false` in Markdown. In HTML, an empty attribute means true, and `controls="false"` means false. See [customization recipes](customize.md) for combinations.

Try these options in the [customization studio](customize.md#playground). Switch among five labs, recolor their annotations, toggle groups and callouts, and export a matching Markdown + CSS recipe with the customized JSON.

## Add it to another Zensical site

The Markdown extension lives in `tools/clab_docs` and installs with this repository's Python project. It emits `<clab-topology>` elements containing escaped YAML and static highlighted source. The browser component and renderer ship in the UI package's `dist-viewer/` directory.

1. Install this repository's Python project into your docs environment (`uv pip install /path/to/containerlab-app`).
2. Build the viewer with `pnpm --filter @containerlab/clab-ui build:viewer`, or obtain `dist-viewer/` from the published `@containerlab/clab-ui` package.
3. Copy the entire `dist-viewer/` directory to your site's `docs/assets/viewer/`.
4. Enable the extension and its assets in your Zensical configuration:

```toml
[project]
watch = ["docs/examples"]
extra_css = ["assets/viewer/component.css"]
extra_javascript = ["assets/viewer/component.mjs"]

[project.markdown_extensions]
"clab_docs.topology" = { docs_dir = "docs" }
```

Use these entries alongside your site's other settings. Asset URLs are relative to the component module, so sites served under a subpath work without a hardcoded domain. For details on registering assets, see [Zensical customization](https://zensical.org/docs/customization/).

Add every directory containing referenced YAML or annotations to `watch`. This makes Zensical rebuild the containing pages when an example changes, including during local preview. Use `zensical build --clean` when changing an installed extension itself.

## Use it in plain HTML

The custom element works without React in the host page. HTML-escape YAML when generating markup, particularly `&`, `<`, and `>`.

```html
<link rel="stylesheet" href="/viewer/component.css">
<script type="module" src="/viewer/component.mjs"></script>

<clab-topology title="My topology" filename="lab.clab.yml" view="split">
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

Serve these files over HTTP(S). Set `theme="light"` or `theme="dark"` on an individual component, or let it follow the system preference. Zensical's `data-md-color-scheme` also works automatically. The optional `viewer-src` attribute can point to another hosted `viewer.html`. The component validates the frame's origin and source before handling messages; the frame receives the allowed parent origin in its URL.

Attributes are read when the element is first connected. To change the topology, replace the element with a new one. Removing a component tears down its iframe, event handlers, and observers. Zensical instant navigation therefore requires no manual initialization hook.

## Colors and dimensions

Set CSS custom properties on the element or a selector matching it. The component passes the canvas colors and font into its iframe; the frame stays isolated from the rest of your page's CSS.

| Property | Controls |
| --- | --- |
| `--clab-surface` | Component and canvas background |
| `--clab-raised` | Toolbar and controls surface |
| `--clab-text`, `--clab-muted` | Primary and secondary text |
| `--clab-accent` | Active controls and focus outline |
| `--clab-edge` | Optional link color |
| `--clab-border` | Component separators |
| `--clab-font` | Component and node label font; use a system font for the fastest start |
| `--clab-radius`, `--clab-shadow` | Frame shape and shadow |
| `--clab-split` | Split columns, for example `2fr 1fr` |
| `--clab-height` | Responsive panel height, for example `clamp(260px, 50vh, 640px)`; omit the `height` attribute to use CSS |

```css
clab-topology.my-diagram {
  --clab-surface: #f5f3ff;
  --clab-text: #302455;
  --clab-accent: #7c3aed;
  --clab-edge: #8b7aa8;
  --clab-radius: 0;
  --clab-shadow: none;
  --clab-split: 2fr 1fr;
}
```

Choose `transparent="false"` to use a custom canvas background with the borderless preset.

## Loading performance

The static viewer shares the GUI's graph renderers without loading its editor, Monaco, map engine, or schema. Saved positions avoid automatic layout work. Text, shape, group, and traffic annotations load their renderers only when used. Examples below the viewport and YAML-only examples defer the canvas entirely.

For an above-the-fold diagram, use `loading="eager"`, keep its annotations alongside its YAML, and serve the generated assets with gzip or Brotli compression and caching. Hashed asset filenames are safe to cache. Very large topologies, rich annotations, device speed, and network conditions affect startup time.

The component emits a bubbling `clab:loaded` event **after the graph has been fitted and painted**. Its `detail` includes `duration` in milliseconds from iframe creation, `nodes`, and `links`.

```js
document.addEventListener("clab:loaded", ({ detail }) => {
  console.log(`Topology ready in ${Math.round(detail.duration)} ms`);
});
```

In this repository, `pnpm docs:build && pnpm docs:perf` checks three cold loads per profile at 10 Mbps and 40 ms latency. At normal CPU speed, the page and viewer together must finish below one second from navigation. With 4× CPU slowdown, viewer startup must remain below one second; total page time is reported separately. The build enforces a 250 KB compressed startup budget and 25 KB CSS budget; `dist-viewer/startup-budget.json` records the measured files.

## Standalone viewer messages

The iframe first sends `clab-viewer:ready`. Its parent replies with `clab-viewer:render`, including `yaml`, optional raw JSON `annotations`, `theme` (`light` or `dark`), optional `borderless` (a boolean), and optional `options`. Individual options override the borderless preset:

```js
frame.contentWindow.postMessage({
  type: "clab-viewer:render",
  yaml,
  theme: "light",
  borderless: true,
  options: {
    controls: true,
    background: "none", // "dots", "lines", or "none"
    transparent: true,
    nodeLabels: true,
    linkLabels: "on-select",
    zoomOnScroll: false,
    panOnDrag: true,
    fitPadding: 0.15,
    appearance: { foreground: "#302455", edge: "#8b7aa8", font: "system-ui" }
  }
}, viewerOrigin);
```

| Message | Direction | Purpose |
| --- | --- | --- |
| `clab-viewer:loaded` | Viewer → parent | Returns node metadata, YAML line ranges, and link count after the fitted graph is painted |
| `clab-viewer:select` | Viewer → parent | Selected `id`, or `null` when cleared |
| `clab-viewer:error` | Viewer → parent | Parse or initialization error `message` |
| `clab-viewer:theme` | Parent → viewer | Update `theme` without remounting |
| `clab-viewer:fit` | Parent → viewer | Fit all nodes in the viewport |
| `clab-viewer:focus` | Parent → viewer | Inspect and focus a node by `id` |

Direct React consumers can use `mountViewer` from `@containerlab/clab-ui/viewer`. Its `viewerOptions` accepts the options above plus `onNodeSelect` and `onInit` callbacks; top-level `onReady` receives the topology description after painting, and `onError` handles rendering errors. `borderless` is a top-level option. Since the renderers use shared stores, use the standalone iframe for multiple independent viewers on one page.
