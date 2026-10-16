---
description: Add nodes, connect interfaces, and edit the topology on the canvas or as YAML.
---

# Build a topology

Draw it or type it. The canvas and the YAML are two views of the same file, and every change shows up in both.
{ .lead }

<figure class="diagram" markdown>

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Leaf–spine fabric" height="380" borderless="true"
```

<figcaption>Every leaf connects to both spines. Scroll to zoom, drag to pan.</figcaption>
</figure>

Unlock the canvas first: select the lock in the toolbar.

## Add nodes

- **Drag a template** from the **Palette** onto the canvas.
- **++shift++ + click** an empty spot to drop your default template there.
- **Copy and paste** existing nodes with ++ctrl+c++ and ++ctrl+v++, or duplicate with ++ctrl+d++.

Names count up from the template's base name: `srl1`, `srl2`, `srl3`. To make your own templates, see [Node templates](templates.md).

## Connect interfaces

**++shift++ + click** the first node, then click the second. The editor picks the next free interface on each side, following the node kind's naming, for example `e1-1` on SR Linux and `eth1` on Linux.

Double-click a link to change its interfaces or properties in the **Link Editor**.

## Connect many at once

**Bulk Link Devices** connects every node matching a **Source Pattern** to every node matching a **Target Pattern**.

| Source | Target | Result |
| --- | --- | --- |
| `leaf*` | `spine*` | A full mesh between leaves and spines |
| `srl?` | `client` | `srl1` to `srl9` each connect to `client` |
| `leaf(\d+)` | `server$1` | `leaf1`–`server1`, `leaf2`–`server2`, … |

![Bulk Link Devices](../images/app/bulk-link-dark.webp#only-dark){ .shot .narrow }
![Bulk Link Devices](../images/app/bulk-link-light.webp#only-light){ .shot .narrow }

## Edit node properties

Double-click a node to open the **Node Editor**: kind, type, image, startup config, binds, environment, ports, and the rest of what containerlab supports.

![Node Editor](../images/app/node-editor-dark.webp#only-dark){ .shot }
![Node Editor](../images/app/node-editor-light.webp#only-light){ .shot }

## Set the boot order

The **Stages** tab of the Node Editor sets containerlab [stages](https://containerlab.dev/manual/nodes/#stages). Under each stage (**Create**, **Create Links**, **Configure**, **Healthy**, **Exit**):

- **Wait for** holds the stage back until another node has finished a stage, for example: create `leaf1` only after `spine1` is healthy.
- **Command** runs a command when the node enters or leaves the stage, in the container or on the host.

Entries from `defaults`, `kinds`, or `groups` are listed with their source and can't be edited here; containerlab adds them to the node's own. The tab flags a node name that doesn't exist and nodes that wait for each other in a loop, since containerlab won't deploy that.

To see the order on the canvas, open the **Links** menu and choose **Show Wait-for Dependencies**. Dashed arrows point from the node that goes first to the node that waits.

## Edit the YAML

**Toggle YAML Split View** opens the file in a panel next to the canvas, on its **YAML** tab. The editor completes and checks containerlab keys as you type, and changes on either side show up on the other.

![Canvas and YAML side by side](../images/app/split-view-dark.webp#only-dark){ .shot }
![Canvas and YAML side by side](../images/app/split-view-light.webp#only-light){ .shot }

YAML is the faster way to change many nodes at once, for example through `defaults` or `kinds`.

## Add networks

The **Palette** also has **Networks**: **Host**, **Mgmt Net**, **Macvlan**, **VXLAN**, **VXLAN Stitch**, **Dummy**, **Bridge**, and **OVS Bridge**. Drag one in and connect nodes to it like to any other node.

## Learn the format

The containerlab manual covers the file in depth: [topology syntax](https://containerlab.dev/manual/topo-def-file/), [node properties](https://containerlab.dev/manual/nodes/), [kinds](https://containerlab.dev/manual/kinds/), and [networking](https://containerlab.dev/manual/network/).

<div class="next" markdown>
[:lucide-arrow-right: Layout and style](appearance.md)
[:lucide-arrow-right: Run a lab](labs.md)
</div>
