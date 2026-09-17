# Think in topologies

A `.clab.yml` file describes the nodes and links in your network. The apps turn that file into an interactive canvas, and changes in the editor become changes in the topology.

## Follow the connections

This fabric has two spines, three leaves, and three clients. Each leaf connects to both spines. Select a device and use **Show in YAML** to find its definition.

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="From a file to a fabric" height="460"
```

## Topology editor

TopoViewer is the shared canvas and source editor.

Use it to:

* add nodes from built-in or custom templates
* drag nodes, networks, and annotations from the palette to the canvas
* create links between nodes
* edit node, link, lab, and annotation properties
* move nodes and arrange the lab
* add free text, shapes, groups, and interface labels
* edit the topology YAML and annotations JSON, including in split view
* save topology changes back to files

When the lab is not running, TopoViewer opens in editor mode. Editor mode allows topology changes and writes them back to the topology file.

When the lab is running, TopoViewer opens in viewer mode. Viewer mode focuses on operational actions and avoids accidental topology changes while the deployed lab is active. You can unlock the canvas when you need to edit visual annotations.

The toolbar also includes **Bulk Link Devices**, **Find Node**, **Fit to Viewport**, **Link Labels**, and **Toggle YAML Split View**. Bulk linking is useful for leaf-spine and numbered topologies: match node names with patterns such as `leaf*`, `spine*`, `srl?`, or `leaf(\d+)` to `spine$1`, then confirm the generated links before they are added.

## Keep topology and presentation separate

The YAML defines the actual lab: device kinds, images, interfaces, and configuration. An optional `.annotations.json` file stores how that topology is presented: positions, icon choices, text, and groups.

Moving a node on the canvas does not change its network connections. Editing the topology file does.

## Work visually or in YAML

In the app, use the node palette to add devices and the link tools to connect their interfaces. The YAML editor is useful for repeated configurations, defaults, and more detailed node properties. Use [layouts and templates](layouts.md) to arrange the canvas and reuse device definitions. See [export and share](sharing.md) to capture or publish the result.

The diagrams in this documentation use a read-only version of that viewer. You can pan, zoom, inspect, and download a topology; edit or deploy it in one of the apps.

## Go deeper

The core containerlab documentation remains the reference for [topology syntax](https://containerlab.dev/manual/topo-def-file/), [node properties](https://containerlab.dev/manual/nodes/), [supported kinds](https://containerlab.dev/manual/kinds/), and [networking](https://containerlab.dev/manual/network/).
