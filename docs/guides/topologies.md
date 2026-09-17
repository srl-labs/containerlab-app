# Think in topologies

A `.clab.yml` file describes the nodes and links in your network. The apps turn that file into an interactive canvas, and changes in the editor become changes in the topology.

## Follow the connections

This fabric has two spines, three leaves, and three clients. Each leaf connects to both spines. Select a device and use **Show in YAML** to find its definition.

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="From a file to a fabric" height="460"
```

## Keep topology and presentation separate

The YAML defines the actual lab: device kinds, images, interfaces, and configuration. An optional `.annotations.json` file stores how that topology is presented: positions, icon choices, text, and groups.

Moving a node on the canvas does not change its network connections. Editing the topology file does.

## Work visually or in YAML

In the app, use the node palette to add devices and the link tools to connect their interfaces. The YAML editor is useful for repeated configurations, defaults, and more detailed node properties. See the [shared workspace guide](../manual/gui/index.md) for layout controls, annotations, custom templates, and exports.

The diagrams in this documentation use a read-only version of that viewer. You can pan, zoom, inspect, and download a topology; edit or deploy it in one of the apps.

## Go deeper

The core containerlab documentation remains the reference for [topology syntax](https://containerlab.dev/manual/topo-def-file/), [node properties](https://containerlab.dev/manual/nodes/), [supported kinds](https://containerlab.dev/manual/kinds/), and [networking](https://containerlab.dev/manual/network/).
