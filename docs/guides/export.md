---
description: Export the canvas as SVG, a Grafana dashboard, a Draw.io, Mermaid or Graphviz diagram, and embed live topologies in your docs.
---

# Export a diagram

Take the topology somewhere else: a slide, a Grafana dashboard, a wiki page, or your own documentation.
{ .lead }

| You want | Use |
| --- | --- |
| An exact picture of the canvas | [SVG](#svg) |
| A live traffic map in Grafana | [Grafana bundle](#grafana-bundle) |
| An editable diagram | [Draw.io](#drawio) |
| A diagram as text, for Markdown or Graphviz | [Mermaid and Graphviz](#mermaid-and-graphviz) |
| An interactive topology in your docs | [The viewer](#interactive-docs) |

## SVG

**Export SVG or Draw.io** in the toolbar opens **Export SVG**. It exports what you see, including your styles, groups, and text. Choose the zoom, padding, background, and whether to include annotations and interface labels.

![Export SVG or Draw.io](../images/app/svg-export-dark.webp#only-dark){ .shot .narrow }
![Export SVG or Draw.io](../images/app/svg-export-light.webp#only-light){ .shot .narrow }

VS Code asks where to save the file. The desktop and web apps download it.

## Grafana bundle

Turn on **Grafana bundle** under **Include** to get three files for the Grafana Flow panel:

| File | Contains |
| --- | --- |
| `<name>.svg` | The diagram, with IDs Grafana can color. |
| `<name>.grafana.json` | A dashboard with the Flow panel. |
| `<name>.flow_panel.yaml` | Which metric colors which link, and the thresholds. |

The panel colors links by traffic and interface state, with optional rate labels and a legend. **Advanced Grafana Settings** set sizes, thresholds, and label shortening.

The bundle is only the picture and the mapping. It expects a Grafana with matching telemetry already set up; it does not deploy one.

## Draw.io

Open **Export SVG or Draw.io** in the toolbar and choose **Draw.io**. The file holds the whole lab with your layout and colors, as shapes you can edit:

| On the canvas | In Draw.io |
| --- | --- |
| Nodes | Shapes with their icon. **Edit Data** shows the kind, type, and image. |
| Links | Connectors that follow when you move a node. |
| Interface labels | Labels attached to their link. |
| Groups | Containers that move with their members. |
| Shapes and text | Shapes and text boxes. |

The page takes the canvas color unless you choose your own. Traffic rate labels and script buttons are left out, and editing the file does not change the lab.

Parallel links curve around a fixed point. If you move only one end of such a link, drag that point to a new place or use **Clear Waypoints** in Draw.io.

VS Code asks where to save the file. The desktop and web apps download it. Use SVG when the diagram should look exactly like your canvas.

## Mermaid and Graphviz

**Export Graph (Mermaid)** and **Export Graph (Graphviz)**, in the actions of a lab, run `containerlab graph --mermaid` or `--dot` on the topology file. The lab does not need to run. Mermaid asks for the direction of the flowchart first.

VS Code saves the file next to the topology and opens it. The desktop and web apps download it.

Labs on a lab host need a clab-api-server that offers these exports. On an older one, the actions say so.

## Interactive docs

The diagrams on this site are the real viewer, reading `.clab.yml` files. You can do the same in your own documentation: readers pan, zoom, inspect nodes, and download the lab. See [Embed the viewer](../viewer/standalone.md).

<div class="next" markdown>
[:lucide-arrow-right: Embed the viewer](../viewer/standalone.md)
[:lucide-arrow-right: Layout and style](appearance.md)
</div>
