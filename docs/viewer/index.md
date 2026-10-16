# Diagrams that speak YAML

Write the topology once in your Zensical docs. Readers get an interactive diagram, the highlighted YAML, and a download of the exact file.
{ .lead }

Each diagram runs in its own iframe, so it never clashes with your theme or with other diagrams on the page.

## Add a fence

In any Markdown page:

````markdown
```clab title="Hello, network" view="split"
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
````

Readers see this:

```clab title="Hello, network" view="split" height="320"
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

## Point at a lab file

For labs people should run, reference the file instead of pasting it. Paths are relative to `docs/`, whatever page the fence is on.

````markdown
```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Leaf–spine fabric" height="460"
```
````

Add the annotations file saved by the app to keep your layout. Without it, the viewer arranges the nodes itself.

## Just the drawing

`borderless="true"` drops the frame, tabs, grid, inspector, and toolbar, and makes the background transparent. Readers can still pan and zoom. The architecture diagrams in these docs are drawn this way.

````markdown
```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Leaf–spine fabric" height="360" borderless="true"
```
````

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Leaf–spine fabric" height="360" borderless="true"
```

The title still names the diagram for assistive technology. Bring back individual controls with options such as `toolbar="true"` or `controls="true"`; see [customization recipes](customize.md). In plain HTML, add the boolean `borderless` attribute to `<clab-topology>`. Without JavaScript, the source remains readable; a viewer error also reveals the YAML.

## What readers can do

- **Topology, YAML, or both.** Keyboard accessible tabs with arrow-key navigation.
- **Inspect a node.** Click a device or choose it from the node menu. Reveal its source lines with **Show in YAML**.
- **Take the lab with you.** Copy or download the original YAML, including comments.
- **Give the diagram room.** Drag to pan, scroll or pinch to zoom, fit the network, or expand the example to full screen.
- **Follow the page theme.** Light and dark modes update the mounted graph.
- **Load when needed.** Offscreen diagrams and examples starting in YAML view do not load the viewer until needed.

The source remains readable when JavaScript is disabled and is included in print output. Examples are read-only; downloading a topology does not deploy anything.

Continue with the [component reference](reference.md) for embedding in another Zensical site or a plain HTML page.
