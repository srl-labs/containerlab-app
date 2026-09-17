# Component reference

## Markdown options

Use a `clab` code fence at the top level of a Markdown page. Option values containing spaces must be quoted.

| Option | Default | Purpose |
| --- | --- | --- |
| `title` | Lab name from YAML | Accessible example title |
| `file` | Inline fence content | YAML file relative to `docs/` |
| `annotations` | Automatic layout | Annotations JSON file relative to `docs/` |
| `view` | `topology` | `topology`, `yaml`, or `split` |
| `height` | `460` | Panel height in pixels, from 240 to 1000 |
| `filename` | File basename or `topology.clab.yml` | Name used when downloading |

A file reference and inline YAML cannot be combined. Missing files, malformed YAML, unknown options, and invalid annotations fail the docs build instead of silently leaving a broken example.

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

Serve these files over HTTP(S). Set `data-md-color-scheme="slate"` on the page's `<body>` for dark mode, or `default` for light mode. The optional `viewer-src` attribute can point to another hosted `viewer.html`. The component validates the frame's origin and source before handling messages; the frame receives the allowed parent origin in its URL.

Attributes are read when the element is first connected. To change the topology, replace the element with a new one. Removing a component tears down its iframe, event handlers, and observers. Zensical instant navigation therefore requires no manual initialization hook.

## Standalone viewer messages

The iframe first sends `clab-viewer:ready`. Its parent replies with `clab-viewer:render`, including `yaml`, optional raw JSON `annotations`, and `theme` (`light` or `dark`).

| Message | Direction | Purpose |
| --- | --- | --- |
| `clab-viewer:loaded` | Viewer → parent | Returns node metadata, YAML line ranges, and link count after initialization |
| `clab-viewer:select` | Viewer → parent | Selected `id`, or `null` when cleared |
| `clab-viewer:error` | Viewer → parent | Parse or initialization error `message` |
| `clab-viewer:theme` | Parent → viewer | Update `theme` without remounting |
| `clab-viewer:fit` | Parent → viewer | Fit all nodes in the viewport |
| `clab-viewer:focus` | Parent → viewer | Inspect and focus a node by `id` |

Direct React consumers can continue to use `mountViewer` from `@containerlab/clab-ui/viewer`. Its optional `viewerOptions` exposes `onNodeSelect`, `onInit`, and `zoomOnScroll`. Since the UI uses shared stores, use the standalone iframe for multiple independent viewers on one page.
