# Diagrams that stay in sync

Write the topology once. Get an interactive diagram, highlighted YAML, and a split view in your documentation. Readers can inspect nodes and download the same file to use in their labs.

The component uses the `@containerlab/clab-ui` standalone viewer. Each diagram runs in its own iframe, keeping its state and styles independent of other diagrams and the documentation theme.

## A fence is all it takes

Add a `clab` fence to a Markdown page:

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

And your readers get this:

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

## Use the actual lab file

For examples that you also run, reference the YAML directly. Paths are relative to the `docs/` directory, regardless of which page contains the fence.

````markdown
```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Leaf–spine fabric" height="460"
```
````

Export an annotations file from the app to preserve a deliberate layout. Without annotations, the viewer arranges the nodes automatically.

## Made for reading

- **Topology, YAML, or both.** Keyboard accessible tabs with arrow-key navigation.
- **Inspect a node.** Click a device or choose it from the node menu. Reveal its source lines with **Show in YAML**.
- **Take the lab with you.** Copy or download the original YAML, including comments.
- **Give the diagram room.** Pan, pinch to zoom, fit the network, or expand the example to full screen.
- **Follow the page theme.** Light and dark modes update the mounted graph.
- **Load when needed.** Offscreen diagrams and examples starting in YAML view do not load the viewer until needed.

The source remains readable when JavaScript is disabled and is included in print output. Examples are read-only; downloading a topology does not deploy anything.

Continue with the [component reference](reference.md) for embedding in another Zensical site or a plain HTML page.
