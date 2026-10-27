---
description: How the VS Code extension, desktop app, and web app reach the Linux host that runs your labs, and which files the editor reads and writes.
---

# How it works

Labs always run on Linux, next to Docker. The apps differ only in how they get there.
{ .lead }

<figure class="diagram" markdown>

```clab file="diagrams/architecture.clab.yml" annotations="diagrams/architecture.clab.yml.annotations.json" title="How the apps reach a lab host" height="390" borderless="true" zoom="false" fit-padding="0.1"
```

<figcaption>VS Code and the desktop app run containerlab on the machine they run on. Every app can also sign in to <code>clab-api-server</code> on a lab host.</figcaption>
</figure>

Every app reaches labs in one of two ways, and shows the labs of both side by side:

- **containerlab on the machine the app runs on.** No server and no sign-in: the app runs containerlab as you. VS Code calls it **Local**, the desktop app **This computer**.
- **`clab-api-server` on a lab host.** You sign in with a Linux account on the [lab host](../install/lab-host.md), and the API server deploys labs, opens terminals, and captures packets there. One app can sign in to several lab hosts at once.

**VS Code** runs containerlab on whatever machine the extension runs on. With Remote SSH, that is the remote server, and your laptop only shows the window. [Lab hosts](../install/vscode.md#work-with-labs-on-a-lab-host) show up next to Local.

**The desktop app** on Linux opens on [the labs of this computer](../install/desktop.md#run-labs-on-this-computer), like VS Code. On macOS and Windows, and for labs elsewhere, it signs in to lab hosts.

**The web app** signs in to lab hosts. On a host you trust, it can also [run labs on its own host](../install/web.md#run-labs-on-the-web-apps-host).

**The browser sandbox** has no lab host. It is the same editor, saving to your browser.

## What works where

| | containerlab on this machine | `clab-api-server` on a lab host |
| --- | --- | --- |
| VS Code | **Local**: Linux, WSL, Remote SSH | Lab hosts, from any OS |
| Desktop app | **This computer**: Linux | Lab hosts, from any OS |
| Web app | Its own host, when turned on | Lab hosts |

Both ways run the same lab actions. A few depend on the API server:

| Feature | containerlab on this machine | `clab-api-server` |
| --- | :---: | :---: |
| Deploy, destroy, redeploy, apply, start, stop, save | :lucide-check: | :lucide-check: |
| Edit topologies and annotations | :lucide-check: | :lucide-check: |
| Node shell, SSH, telnet, logs | :lucide-check: | :lucide-check: |
| Packet capture, Wireshark in a tab or Edgeshark | :lucide-check: | :lucide-check: |
| Link impairments | :lucide-check: | :lucide-check: |
| Install Edgeshark, manage container images | :lucide-check: | :lucide-check: |
| Draw.io diagrams | :lucide-check: | :lucide-check: |
| Import or deploy a lab from GitHub or GitLab | :lucide-check: | :lucide-check: |
| Host CPU, memory, and disk | :lucide-check: | :lucide-check: |
| Several users on one lab host, each with their own labs | | :lucide-check: |
| [Shared labs](../guides/shared-labs.md) in `@shared` | | :lucide-check: |
| SSH to a node through a port the lab host forwards | | :lucide-check: |
| Interactive Draw.io editing (VS Code) | :lucide-check: | |
| Sign-in | none, runs as you | Linux account in `clab_api` or `clab_admins` |

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

Labs open locked by default, so a stray drag changes nothing. Select the lock in the toolbar to start editing. An empty lab opens unlocked.

<div class="next" markdown>
[:lucide-arrow-right: Install an app](index.md)
[:lucide-arrow-right: Tour the workspace](../guides/workspace.md)
</div>
