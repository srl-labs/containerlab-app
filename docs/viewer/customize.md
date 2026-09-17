---
title: Customization studio
hide:
  - toc
---

<div class="studio-intro" markdown>

<span class="studio-eyebrow">THE CUSTOMIZATION STUDIO</span>

# Your network.<br>A different point of view.

Give the diagram as much thought as the lab. Explore five distinct topologies, from a quiet addressing guide to a fabric after dark. Every device, callout, and boundary is rendered by the real viewer.

<div class="studio-jumps">
<a href="#playground">Open the playground <span aria-hidden="true">↗</span></a>
<a href="#collection">Explore the collection <span aria-hidden="true">↓</span></a>
<span>05 LABS &nbsp; / &nbsp; ALL SOURCE INCLUDED</span>
</div>
</div>

## Make it yours { #playground }

Pick a lab. Change the atmosphere. Strip it back or bring every detail forward.

Try **Synthwave** for neon pink and cyan, **Aurora** for mint and ice blue, **Ember** for warm copper and coral, or **Porcelain** for a cream canvas with muted jewel tones.

<div class="studio-shell">
<clab-customizer>
<form class="studio-form" hidden aria-label="Customize the topology">
<div class="studio-selects">
<label>Topology<select name="lab"><option value="midnight-fabric">01 · Midnight fabric</option><option value="fabric-101">02 · Fabric field notes</option><option value="security-zones">03 · Trust boundaries</option><option value="wan-ring">04 · The scenic route</option><option value="packet-walk">05 · Follow the packet</option></select></label>
<label>Palette<select name="palette"><option value="original">As designed</option><option value="paper">Paper</option><option value="midnight">Midnight</option><option value="blueprint">Blueprint</option><option value="synthwave">Synthwave</option><option value="aurora">Aurora</option><option value="ember">Ember</option><option value="porcelain">Porcelain</option></select></label>
<label>Presentation<select name="presentation"><option value="figure">Figure</option><option value="explorer">Explorer</option><option value="split">Diagram + YAML</option></select></label>
<label>Grid<select name="grid"><option value="none">None</option><option value="dots">Dots</option><option value="lines">Lines</option></select></label>
<label>Interfaces<select name="link-labels"><option value="hide">Hidden</option><option value="on-select">On selection</option><option value="show-all">Always visible</option></select></label>
</div>
<div class="studio-toggles">
<label><input type="checkbox" name="groups" checked> Groups</label>
<label><input type="checkbox" name="notes" checked> Notes &amp; IPs</label>
<label><input type="checkbox" name="shapes" checked> Shapes &amp; arrows</label>
<label><input type="checkbox" name="node-labels" checked> Device names</label>
<label><input type="checkbox" name="controls" checked> Zoom buttons</label>
<label><input type="checkbox" name="zoom"> Wheel zoom</label>
<label><input type="checkbox" name="pan" checked> Pan</label>
<label><input type="checkbox" name="transparent"> Transparent</label>
</div>
<div class="studio-ranges">
<label>Height <output data-for="height">520 px</output><input aria-label="Canvas height" type="range" name="height" min="300" max="760" step="20" value="520"></label>
<label>Node corners <output data-for="corners">12 px</output><input aria-label="Node corners" type="range" name="corners" min="0" max="24" step="2" value="12"></label>
<label>Breathing room <output data-for="padding">12 %</output><input aria-label="Fit padding" type="range" name="padding" min="4" max="40" step="2" value="12"></label>
<button type="reset">Reset style <span aria-hidden="true">↺</span></button>
</div>
</form>
<div class="studio-preview" data-palette="midnight">
<div class="studio-preview-label"><span><i></i> LIVE CANVAS</span><span data-lab-caption>01 / MIDNIGHT FABRIC</span></div>
<div data-preview>

```clab file="examples/midnight-fabric.clab.yml" annotations="examples/midnight-fabric.clab.yml.annotations.json" title="Midnight fabric playground" borderless="true" theme="dark" controls="true" zoom="false" fit-padding="0.12" height="520" loading="eager"
```

</div>
</div>
<div class="studio-export" hidden>
<div class="studio-export-bar"><span>Your next diagram starts here.</span><div><button type="button" data-copy>Copy recipe</button><a data-yaml download>YAML ↓</a><button type="button" data-annotations>Annotations ↓</button></div></div>
<p class="studio-status" role="status" aria-live="polite"></p>
<details><summary>View the Markdown + CSS recipe</summary><pre class="no-copy"><code data-recipe></code></pre></details>
<p class="studio-export-help">Save both downloads under <code>docs/examples/</code>, then paste the recipe into your page. The annotations download includes your palette, corners, and visible layers.</p>
</div>
<noscript>Use the examples below to explore the source. The live controls need JavaScript.</noscript>
</clab-customizer>
</div>

## Five labs. Five personalities. { #collection }

These are starting points you can take apart. Each pairs a containerlab YAML file with an editable annotations file. The first four supply wiring for an exercise; the Linux walkthrough also configures addresses and routes.

<div class="studio-collection" markdown>

<div class="studio-example" id="midnight-fabric" markdown>
<div class="studio-example-heading" markdown="0"><span class="studio-number">01</span><div><span class="studio-eyebrow">INFRASTRUCTURE / MIDNIGHT</span><h3>Every rack. Two paths.</h3></div><span class="studio-count">10 nodes · 12 links</span></div>

Two spines, four racks, and a clear visual hierarchy. Lime marks shared transit, teal marks the leaves, and slate marks the compute layer. Rounded rack groups give a dense fabric room to breathe.

<div class="studio-art" data-palette="midnight">

```clab file="examples/midnight-fabric.clab.yml" annotations="examples/midnight-fabric.clab.yml.annotations.json" title="Midnight rack fabric" borderless="true" theme="dark" zoom="false" controls="true" fit-padding="0.12" height="540"
```

</div>
<div class="studio-example-footer" markdown>
<span class="studio-tags">RACK GROUPS · ROLE COLORS · SAVED POSITIONS</span>

[Topology YAML ↓](../examples/midnight-fabric.clab.yml){ download="midnight-fabric.clab.yml" } · [Annotations ↓](../examples/midnight-fabric.clab.yml.annotations.json){ download="midnight-fabric.clab.yml.annotations.json" } · [Remix in playground ↑](#playground){ data-remix="midnight-fabric" }
</div>
</div>

<div class="studio-example" id="fabric-101" markdown>
<div class="studio-example-heading" markdown="0"><span class="studio-number">02</span><div><span class="studio-eyebrow">FIELD NOTES / PAPER</span><h3>Small fabric. Every detail.</h3></div><span class="studio-count">3 nodes · 2 links</span></div>

An illustration that belongs in an article. Inspired by the Fabric 101 documentation example: sage device cards, paired interface/IP callouts, and a quiet design note. The /31 addresses are a proposed plan, not device configuration.

<div class="studio-art" data-palette="paper">

```clab file="examples/fabric-101.clab.yml" annotations="examples/fabric-101.clab.yml.annotations.json" title="Fabric field notes" borderless="true" theme="light" zoom="false" pan="false" fit-padding="0.10" height="390"
```

</div>
<div class="studio-example-footer" markdown>
<span class="studio-tags">ENDPOINT CALLOUTS · MARKDOWN NOTES · QUIET CANVAS</span>

[Topology YAML ↓](../examples/fabric-101.clab.yml){ download="fabric-101.clab.yml" } · [Annotations ↓](../examples/fabric-101.clab.yml.annotations.json){ download="fabric-101.clab.yml.annotations.json" } · [Remix in playground ↑](#playground){ data-remix="fabric-101" }
</div>
</div>

<div class="studio-example" id="security-zones" markdown>
<div class="studio-example-heading" markdown="0"><span class="studio-number">03</span><div><span class="studio-eyebrow">SECURITY DESIGN / SANDSTONE</span><h3>Draw the trust boundary.</h3></div><span class="studio-count">6 nodes · 5 links</span></div>

An outside client, public services, and a private application tier. Peach, amber, and lavender groups separate the zones; a dashed boundary makes the policy discussion visible. Configure forwarding and firewall rules as the next exercise.

<div class="studio-art" data-palette="sandstone">

```clab file="examples/security-zones.clab.yml" annotations="examples/security-zones.clab.yml.annotations.json" title="Security trust boundaries" borderless="true" theme="light" zoom="false" controls="true" fit-padding="0.12" height="480"
```

</div>
<div class="studio-example-footer" markdown>
<span class="studio-tags">TRUST ZONES · SHAPE ANNOTATIONS · NUMBERED CALLOUTS</span>

[Topology YAML ↓](../examples/security-zones.clab.yml){ download="security-zones.clab.yml" } · [Annotations ↓](../examples/security-zones.clab.yml.annotations.json){ download="security-zones.clab.yml.annotations.json" } · [Remix in playground ↑](#playground){ data-remix="security-zones" }
</div>
</div>

<div class="studio-example" id="wan-ring" markdown>
<div class="studio-example-heading" markdown="0"><span class="studio-number">04</span><div><span class="studio-eyebrow">WIDE AREA / AFTER HOURS</span><h3>The long way is still a way.</h3></div><span class="studio-count">6 nodes · 6 links</span></div>

Six cities form a physical ring around a central annotation. A violet canvas, two node colors, and a dashed halo turn the topology into a routing exercise: configure the network, break a link, then follow the alternate path.

<div class="studio-art" data-palette="violet">

```clab file="examples/wan-ring.clab.yml" annotations="examples/wan-ring.clab.yml.annotations.json" title="Six-city WAN ring" borderless="true" theme="dark" zoom="false" controls="true" fit-padding="0.12" height="480"
```

</div>
<div class="studio-example-footer" markdown>
<span class="studio-tags">RADIAL LAYOUT · CIRCLE OVERLAY · EXERCISE PROMPT</span>

[Topology YAML ↓](../examples/wan-ring.clab.yml){ download="wan-ring.clab.yml" } · [Annotations ↓](../examples/wan-ring.clab.yml.annotations.json){ download="wan-ring.clab.yml.annotations.json" } · [Remix in playground ↑](#playground){ data-remix="wan-ring" }
</div>
</div>

<div class="studio-example" id="packet-walk" markdown>
<div class="studio-example-heading" markdown="0"><span class="studio-number">05</span><div><span class="studio-eyebrow">LEARN BY DOING / MINT</span><h3>Follow one packet.</h3></div><span class="studio-count">3 nodes · 2 links</span></div>

A runnable Linux lab with two subnets and IP forwarding. Address labels explain each hop; solid and dashed arrows show the request and return directions. Deploy the YAML, then run `docker exec clab-packet-walk-client ping -c 3 10.10.2.2` on your lab host.

<div class="studio-art" data-palette="mint">

```clab file="examples/packet-walk.clab.yml" annotations="examples/packet-walk.clab.yml.annotations.json" title="Linux packet walkthrough" borderless="true" theme="light" zoom="false" controls="true" fit-padding="0.10" height="400"
```

</div>
<div class="studio-example-footer" markdown>
<span class="studio-tags">DIRECTIONAL ARROWS · SUBNET GROUPS · READY TO PING</span>

[Topology YAML ↓](../examples/packet-walk.clab.yml){ download="packet-walk.clab.yml" } · [Annotations ↓](../examples/packet-walk.clab.yml.annotations.json){ download="packet-walk.clab.yml.annotations.json" } · [Remix in playground ↑](#playground){ data-remix="packet-walk" }
</div>
</div>
</div>

## Build your own visual language

| Change the… | Use… | Try it in… |
| --- | --- | --- |
| Shape of the story | Saved `nodeAnnotations` positions and role-specific icons | Midnight fabric |
| Rack, subnet, or security boundaries | `groupStyleAnnotations` with fills, borders, labels, and corners | Trust boundaries |
| Interface and addressing detail | Markdown `freeTextAnnotations` with monospace text and a background | Fabric field notes |
| Direction and emphasis | `freeShapeAnnotations` lines, arrowheads, circles, and dashed borders | Follow the packet |
| Mood of the canvas | CSS color tokens, a pinned theme, and a grid | Any lab → Blueprint palette |
| Amount of interface | Borderless figure, full explorer, or split source view | Presentation selector |
| Reading experience | Disable wheel zoom, choose pan, set height and fit padding | Playground controls |

Annotations travel with the lab as a separate JSON file. You can edit them in the [topology editor](../guides/topologies.md), or use these files as a starting point. Diagrams and annotations are read-only in the documentation viewer.

For all Markdown attributes, CSS tokens, and the HTML and React APIs, see the [component reference](reference.md).
