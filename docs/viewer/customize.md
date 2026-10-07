---
title: Customization studio
hide:
  - toc
---

# Customization studio

Annotations control how a topology looks in the viewer: node positions, icons and colors, groups, notes, shapes, and display settings such as the node style and link style. This page has two parts:

- The [studio](#playground) applies viewer settings to an example lab and exports the result for your own documentation.
- The [example labs](#collection) show what annotations can express. Each example links to its topology and annotations files.

## Studio { #playground }

Choose a lab and change its settings. The preview updates as you go. To reuse the result, copy the Markdown snippet and download the topology and annotations files.

<div class="studio-shell">
<clab-customizer>
<div class="studio-workbench">
<form class="studio-form" hidden aria-label="Customize the topology">
<fieldset class="studio-group">
<legend>Lab</legend>
<label class="studio-field"><span>Topology</span><select name="lab"><option value="midnight-fabric">01 · Leaf-spine fabric</option><option value="fabric-101">02 · Fabric 101 addressing</option><option value="security-zones">03 · Security zones</option><option value="wan-ring">04 · WAN ring</option><option value="packet-walk">05 · Packet walk</option><option value="dual-homed">06 · Dual-homed hosts</option><option value="branch-office">07 · Branch office</option><option value="frosted-glass">08 · Frosted glass</option></select></label>
</fieldset>
<fieldset class="studio-group">
<legend>Colors</legend>
<div class="studio-swatches" role="radiogroup" aria-label="Palette"><label data-palette="paper"><input type="radio" name="palette" value="paper"><i aria-hidden="true"></i><span>Paper</span></label><label data-palette="sandstone"><input type="radio" name="palette" value="sandstone"><i aria-hidden="true"></i><span>Sandstone</span></label><label data-palette="mint"><input type="radio" name="palette" value="mint"><i aria-hidden="true"></i><span>Mint</span></label><label data-palette="porcelain"><input type="radio" name="palette" value="porcelain"><i aria-hidden="true"></i><span>Porcelain</span></label><label data-palette="midnight"><input type="radio" name="palette" value="midnight"><i aria-hidden="true"></i><span>Midnight</span></label><label data-palette="violet"><input type="radio" name="palette" value="violet"><i aria-hidden="true"></i><span>Violet</span></label><label data-palette="blueprint"><input type="radio" name="palette" value="blueprint"><i aria-hidden="true"></i><span>Blueprint</span></label><label data-palette="synthwave"><input type="radio" name="palette" value="synthwave"><i aria-hidden="true"></i><span>Synthwave</span></label><label data-palette="aurora"><input type="radio" name="palette" value="aurora"><i aria-hidden="true"></i><span>Aurora</span></label><label data-palette="ember"><input type="radio" name="palette" value="ember"><i aria-hidden="true"></i><span>Ember</span></label></div>
</fieldset>
<fieldset class="studio-group">
<legend>Nodes</legend>
<div class="studio-field"><span>Style</span><div class="studio-segmented" role="radiogroup" aria-label="Node style"><label><input type="radio" name="node-style" value="icon"><span>Icons</span></label><label><input type="radio" name="node-style" value="boxed"><span>Boxed</span></label></div></div>
</fieldset>
<fieldset class="studio-group">
<legend>Links</legend>
<div class="studio-field"><span>Shape</span><div class="studio-segmented" role="radiogroup" aria-label="Link style"><label><input type="radio" name="link-style" value="straight"><span>Straight</span></label><label><input type="radio" name="link-style" value="elbow"><span>Elbow</span></label></div></div>
<div class="studio-field"><span>Interface names</span><div class="studio-segmented" role="radiogroup" aria-label="Interface names"><label><input type="radio" name="link-labels" value="hide" checked><span>Hidden</span></label><label><input type="radio" name="link-labels" value="on-select"><span>On select</span></label><label><input type="radio" name="link-labels" value="show-all"><span>Always</span></label></div></div>
<label class="studio-switch"><span>Telemetry style</span><input type="checkbox" role="switch" name="telemetry"></label>
<label class="studio-switch"><span>Highlight on hover</span><input type="checkbox" role="switch" name="link-hover" checked></label>
</fieldset>
<fieldset class="studio-group">
<legend>Show</legend>
<label class="studio-switch"><span>Device names</span><input type="checkbox" role="switch" name="node-labels" checked></label>
<label class="studio-switch"><span>Groups</span><input type="checkbox" role="switch" name="groups" checked></label>
<label class="studio-switch"><span>Notes and addresses</span><input type="checkbox" role="switch" name="notes" checked></label>
<label class="studio-switch"><span>Shapes and arrows</span><input type="checkbox" role="switch" name="shapes" checked></label>
</fieldset>
<fieldset class="studio-group">
<legend>Frame</legend>
<div class="studio-field"><span>Presentation</span><div class="studio-segmented" role="radiogroup" aria-label="Presentation"><label><input type="radio" name="presentation" value="figure" checked><span>Canvas</span></label><label><input type="radio" name="presentation" value="explorer"><span>Explorer</span></label><label><input type="radio" name="presentation" value="split"><span>With YAML</span></label></div></div>
<div class="studio-field"><span>Grid</span><div class="studio-segmented" role="radiogroup" aria-label="Grid"><label><input type="radio" name="grid" value="none" checked><span>None</span></label><label><input type="radio" name="grid" value="dots"><span>Dots</span></label><label><input type="radio" name="grid" value="lines"><span>Lines</span></label></div></div>
<label class="studio-range"><span>Height <output data-for="height">520 px</output></span><input aria-label="Canvas height" type="range" name="height" min="300" max="760" step="20" value="520"></label>
<label class="studio-range"><span>Node corners <output data-for="corners">12 px</output></span><input aria-label="Node corners" type="range" name="corners" min="0" max="24" step="2" value="12"></label>
<label class="studio-range"><span>Space around <output data-for="padding">12 %</output></span><input aria-label="Space around the diagram" type="range" name="padding" min="4" max="40" step="2" value="12"></label>
</fieldset>
<fieldset class="studio-group">
<legend>Interaction</legend>
<label class="studio-switch"><span>Zoom buttons</span><input type="checkbox" role="switch" name="controls" checked></label>
<label class="studio-switch"><span>Zoom with the wheel</span><input type="checkbox" role="switch" name="zoom"></label>
<label class="studio-switch"><span>Drag to pan</span><input type="checkbox" role="switch" name="pan" checked></label>
<label class="studio-switch"><span>Transparent background</span><input type="checkbox" role="switch" name="transparent"></label>
</fieldset>
<button type="reset">Reset settings</button>
</form>
<div class="studio-stage">
<div class="studio-preview" data-palette="midnight">
<div class="studio-preview-label"><span><i></i> <span data-live-status>PREVIEW</span></span><span data-lab-caption>01 / LEAF-SPINE FABRIC</span></div>
<div data-preview>

```clab file="examples/midnight-fabric.clab.yml" annotations="examples/midnight-fabric.clab.yml.annotations.json" title="Leaf-spine fabric" borderless="true" theme="dark" controls="true" zoom="false" link-hover="true" fit-padding="0.12" height="520" loading="eager"
```

</div>
</div>
<div class="studio-export" hidden>
<div class="studio-export-bar"><div><strong>Export</strong><span>A Markdown snippet, the topology, and the annotations.</span></div><div><button type="button" data-copy>Copy Markdown</button><a data-yaml download>Download YAML</a><button type="button" data-annotations>Download annotations</button></div></div>
<p class="studio-status" role="status" aria-live="polite"></p>
<details><summary>Show the Markdown and CSS</summary><pre class="no-copy"><code data-recipe></code></pre></details>
<p class="studio-export-help">Save both downloads under <code>docs/examples/</code> and paste the Markdown where the diagram should appear. The annotations file stores the colors, corners, node style, link style, and visible layers.</p>
</div>
</div>
</div>
<noscript>The studio needs JavaScript. The example labs below link to their source files.</noscript>
</clab-customizer>
</div>

## Example labs { #collection }

Each example pairs a containerlab topology file with an annotations file. Use them as a starting point for your own diagrams. The packet walk lab also configures addresses and routes; the others only define nodes and links.

<div class="studio-collection" markdown>

<div class="studio-example" id="midnight-fabric" markdown>
<div class="studio-example-heading" markdown="0"><span class="studio-number">01</span><h3>Leaf-spine fabric</h3><span class="studio-count">10 nodes · 12 links</span></div>

Two spines and four racks with a leaf and a server each. Group annotations draw the racks, and icon colors separate spines, leaves, and servers.

<div class="studio-art" data-palette="midnight">

```clab file="examples/midnight-fabric.clab.yml" annotations="examples/midnight-fabric.clab.yml.annotations.json" title="Leaf-spine fabric" borderless="true" theme="dark" zoom="false" controls="true" fit-padding="0.12" height="540"
```

</div>
<div class="studio-example-footer" markdown>
[Topology](../examples/midnight-fabric.clab.yml){ download="midnight-fabric.clab.yml" } · [Annotations](../examples/midnight-fabric.clab.yml.annotations.json){ download="midnight-fabric.clab.yml.annotations.json" } · [Open in the studio](#playground){ data-remix="midnight-fabric" }
</div>
</div>

<div class="studio-example" id="fabric-101" markdown>
<div class="studio-example-heading" markdown="0"><span class="studio-number">02</span><h3>Fabric 101 addressing</h3><span class="studio-count">3 nodes · 2 links</span></div>

A spine and two leaves based on the Fabric 101 example. Text annotations label each interface with a /31 address. The addresses are a proposed plan and are not configured on the nodes.

<div class="studio-art" data-palette="paper">

```clab file="examples/fabric-101.clab.yml" annotations="examples/fabric-101.clab.yml.annotations.json" title="Fabric 101 addressing" borderless="true" theme="light" zoom="false" pan="false" fit-padding="0.10" height="390"
```

</div>
<div class="studio-example-footer" markdown>
[Topology](../examples/fabric-101.clab.yml){ download="fabric-101.clab.yml" } · [Annotations](../examples/fabric-101.clab.yml.annotations.json){ download="fabric-101.clab.yml.annotations.json" } · [Open in the studio](#playground){ data-remix="fabric-101" }
</div>
</div>

<div class="studio-example" id="security-zones" markdown>
<div class="studio-example-heading" markdown="0"><span class="studio-number">03</span><h3>Security zones</h3><span class="studio-count">6 nodes · 5 links</span></div>

An outside client, public services, and a private application tier. Groups mark the three zones and a dashed shape marks the trust boundary. Forwarding and filtering are left for you to configure.

<div class="studio-art" data-palette="sandstone">

```clab file="examples/security-zones.clab.yml" annotations="examples/security-zones.clab.yml.annotations.json" title="Security zones" borderless="true" theme="light" zoom="false" controls="true" fit-padding="0.12" height="480"
```

</div>
<div class="studio-example-footer" markdown>
[Topology](../examples/security-zones.clab.yml){ download="security-zones.clab.yml" } · [Annotations](../examples/security-zones.clab.yml.annotations.json){ download="security-zones.clab.yml.annotations.json" } · [Open in the studio](#playground){ data-remix="security-zones" }
</div>
</div>

<div class="studio-example" id="wan-ring" markdown>
<div class="studio-example-heading" markdown="0"><span class="studio-number">04</span><h3>WAN ring</h3><span class="studio-count">6 nodes · 6 links</span></div>

Six sites connected in a ring, laid out around a circle shape. Configure routing, disable a link, and check that traffic takes the other direction around the ring.

<div class="studio-art" data-palette="violet">

```clab file="examples/wan-ring.clab.yml" annotations="examples/wan-ring.clab.yml.annotations.json" title="WAN ring" borderless="true" theme="dark" zoom="false" controls="true" fit-padding="0.12" height="480"
```

</div>
<div class="studio-example-footer" markdown>
[Topology](../examples/wan-ring.clab.yml){ download="wan-ring.clab.yml" } · [Annotations](../examples/wan-ring.clab.yml.annotations.json){ download="wan-ring.clab.yml.annotations.json" } · [Open in the studio](#playground){ data-remix="wan-ring" }
</div>
</div>

<div class="studio-example" id="packet-walk" markdown>
<div class="studio-example-heading" markdown="0"><span class="studio-number">05</span><h3>Packet walk</h3><span class="studio-count">3 nodes · 2 links</span></div>

A Linux lab with two subnets and a router with IP forwarding. Address labels mark each hop, and solid and dashed arrows show the request and reply paths. After deploying, run `docker exec clab-packet-walk-client ping -c 3 10.10.2.2` on the lab host.

<div class="studio-art" data-palette="mint">

```clab file="examples/packet-walk.clab.yml" annotations="examples/packet-walk.clab.yml.annotations.json" title="Packet walk" borderless="true" theme="light" zoom="false" controls="true" fit-padding="0.10" height="400"
```

</div>
<div class="studio-example-footer" markdown>
[Topology](../examples/packet-walk.clab.yml){ download="packet-walk.clab.yml" } · [Annotations](../examples/packet-walk.clab.yml.annotations.json){ download="packet-walk.clab.yml.annotations.json" } · [Open in the studio](#playground){ data-remix="packet-walk" }
</div>
</div>

<div class="studio-example" id="dual-homed" markdown>
<div class="studio-example-heading" markdown="0"><span class="studio-number">06</span><h3>Dual-homed hosts</h3><span class="studio-count">7 nodes · 10 links</span></div>

Two spines, three leaves, and two hosts, each host connected to two leaves. Links use the elbow style: they bend at right angles between the layers, and crossing links show a small gap. Hover over a link to highlight it and both of its nodes.

<div class="studio-art" data-palette="blueprint">

```clab file="examples/dual-homed.clab.yml" annotations="examples/dual-homed.clab.yml.annotations.json" title="Dual-homed hosts" borderless="true" theme="dark" grid="lines" zoom="false" controls="true" link-hover="true" fit-padding="0.10" height="560"
```

</div>
<div class="studio-example-footer" markdown>
[Topology](../examples/dual-homed.clab.yml){ download="dual-homed.clab.yml" } · [Annotations](../examples/dual-homed.clab.yml.annotations.json){ download="dual-homed.clab.yml.annotations.json" } · [Open in the studio](#playground){ data-remix="dual-homed" }
</div>
</div>

<div class="studio-example" id="branch-office" markdown>
<div class="studio-example-heading" markdown="0"><span class="studio-number">07</span><h3>Branch office</h3><span class="studio-count">8 nodes · 9 links</span></div>

Two internet uplinks, an edge router, a redundant core, and three floor switches. With elbow links and all interface names shown, each name is placed along its own link next to the node.

<div class="studio-art" data-palette="porcelain">

```clab file="examples/branch-office.clab.yml" annotations="examples/branch-office.clab.yml.annotations.json" title="Branch office" borderless="true" theme="light" zoom="false" controls="true" link-hover="true" fit-padding="0.06" height="640"
```

</div>
<div class="studio-example-footer" markdown>
[Topology](../examples/branch-office.clab.yml){ download="branch-office.clab.yml" } · [Annotations](../examples/branch-office.clab.yml.annotations.json){ download="branch-office.clab.yml.annotations.json" } · [Open in the studio](#playground){ data-remix="branch-office" }
</div>
</div>

<div class="studio-example" id="frosted-glass" markdown>
<div class="studio-example-heading" markdown="0"><span class="studio-number">08</span><h3>Frosted glass</h3><span class="studio-count">6 nodes · 7 links</span></div>

Boxed nodes with a low-opacity fill, a light border, and a background blur, placed over colored shape annotations. Links use the elbow style. Hover over a link to highlight it and both of its nodes.

<div class="studio-art" data-palette="synthwave">

```clab file="examples/frosted-glass.clab.yml" annotations="examples/frosted-glass.clab.yml.annotations.json" title="Frosted glass" borderless="true" theme="dark" zoom="false" controls="true" link-hover="true" fit-padding="0.10" height="560"
```

</div>
<div class="studio-example-footer" markdown>
[Topology](../examples/frosted-glass.clab.yml){ download="frosted-glass.clab.yml" } · [Annotations](../examples/frosted-glass.clab.yml.annotations.json){ download="frosted-glass.clab.yml.annotations.json" } · [Open in the studio](#playground){ data-remix="frosted-glass" }
</div>
</div>
</div>

## Annotations used in the examples

| Feature | Annotation or option | Example |
| --- | --- | --- |
| Node positions and icons | `nodeAnnotations` with `position`, `icon`, and `iconColor` | Leaf-spine fabric |
| Racks, subnets, and zones | `groupStyleAnnotations` with fill, border, label, and corner radius | Security zones |
| Interface and address labels | `freeTextAnnotations` with Markdown, monospace text, and a background | Fabric 101 addressing |
| Arrows, circles, and boundaries | `freeShapeAnnotations` with lines, arrowheads, circles, and dashed borders | Packet walk |
| Boxed nodes | `viewerSettings.nodeStyle: "boxed"`, with an optional per-node `box` for fill, opacity, blur, and border | Frosted glass |
| Telemetry style | `viewerSettings.style: "telemetry-style"` | Studio, **Telemetry style** |
| Elbow links | `viewerSettings.linkStyle: "elbow"`, or `link-style="elbow"` on the code block | Dual-homed hosts |
| Link highlighting | `link-hover="true"` highlights a hovered link and both of its nodes | Dual-homed hosts |
| Interface names along links | Elbow links with `link-labels="show-all"` | Branch office |
| Canvas colors | CSS color tokens, a fixed theme, and a grid | Studio, **Colors** |
| Presentation | Borderless figure, explorer, or split view with the YAML source | Studio, **Frame** |
| Interaction | Wheel zoom, panning, height, and fit padding | Studio, **Interaction** |

Annotations are stored in a separate JSON file next to the topology. You can edit them in the [topology editor](../guides/topologies.md) or start from the files above. The documentation viewer is read-only.

For all Markdown attributes, CSS tokens, and the HTML and React APIs, see the [component reference](reference.md).
