---
description: How the VS Code extension, desktop app, and web app reach the Linux host that runs your labs, and which files the editor reads and writes.
---

# How it works

Labs always run on Linux, next to Docker. The apps differ only in how they get there.
{ .lead }

<figure class="diagram" markdown>

```clab file="diagrams/architecture.clab.yml" annotations="diagrams/architecture.clab.yml.annotations.json" title="How the apps reach a lab host" height="390" borderless="true" zoom="false" fit-padding="0.1"
```

<figcaption>VS Code runs containerlab itself. The desktop and web apps talk to <code>clab-api-server</code> on the lab host.</figcaption>
</figure>

**VS Code** runs containerlab directly, on whatever machine the extension runs on. With Remote SSH, that is the remote server, and your laptop only shows the window.

**The desktop and web apps** never touch Docker. They sign in to [`clab-api-server`](../install/lab-host.md) on the lab host, and the API server deploys labs, opens terminals, and captures packets there. One app can sign in to several lab hosts at once.

**The browser sandbox** has no lab host. It is the same editor, saving to your browser.

## Two files per lab

A lab is a containerlab topology file. The editor adds a second file next to it for everything visual.

<div class="facts" markdown>
<div markdown>

`lab.clab.yml`

Nodes, kinds, images, links, configuration. This is what containerlab deploys. Edit it on the canvas or as text; both stay in sync.

</div>
<div markdown>

`lab.clab.yml.annotations.json`

Positions, icons, colors, groups, text, and display settings. Containerlab ignores it.

</div>
<div markdown>

Your own config files

Startup configs and binds referenced from the YAML. The editor leaves them alone.

</div>
</div>

Moving a node changes only the annotations. Connecting two interfaces changes the YAML. Both files are plain text, so they work in Git and with the containerlab CLI.

The same topology, without and with its annotations file:

<div class="pair" markdown>
<div markdown>

YAML only

```clab file="examples/fabric.clab.yml" title="Fabric with automatic layout" link-labels="hide" height="280" borderless="true" zoom="false" fit-padding="0.12"
```

The editor picks a layout.

</div>
<div markdown>

YAML + annotations

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Fabric with saved layout" height="280" borderless="true" zoom="false" fit-padding="0.12"
```

Your positions and icons.

</div>
</div>

## Editing a running lab

You can keep editing while a lab runs. The play button then shows that the file differs from what is deployed. **Apply** lists what containerlab would change, and applies it when you confirm. See [Run a lab](../guides/labs.md).

Labs open locked by default, so a stray drag changes nothing. Select the lock in the toolbar to start editing.

<div class="next" markdown>
[:lucide-arrow-right: Install an app](index.md)
[:lucide-arrow-right: Tour the workspace](../guides/workspace.md)
</div>
