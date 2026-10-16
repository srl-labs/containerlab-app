---
description: Install the containerlab extension for VS Code and run labs locally, in WSL, or on a remote server over Remote SSH.
---

# VS Code extension

The extension puts the topology editor and the lab explorer inside VS Code. It runs containerlab directly; no API server involved.
{ .lead }

<figure class="diagram" markdown>

```clab file="diagrams/vscode-host.clab.yml" annotations="diagrams/vscode-host.clab.yml.annotations.json" title="Where the VS Code extension runs" height="320" borderless="true" zoom="false" fit-padding="0.1"
```

<figcaption>Labs run wherever the extension runs. With Remote SSH, that is the server, not your laptop.</figcaption>
</figure>

## Prepare the lab machine

On the Linux machine (or WSL distribution) where labs should run:

- [Install containerlab](https://containerlab.dev/install/). The extension offers to install it when it cannot find the binary.
- Make sure Docker works for your user.
- Run VS Code as root, or add your user to the `clab_admins` and `docker` groups.

For a remote server, install the [Remote SSH extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh) on your laptop and connect to the server first. Everything below then happens on the server.

## Install

<div class="steps" markdown>

1. **Install the extension.** Get it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=srl-labs.vscode-containerlab), or search for `Containerlab` in the Extensions view.

2. **Open a folder** that contains `*.clab.yml` files, or an empty folder for a new lab.

3. **Select the containerlab icon** in the Activity Bar. The explorer lists your topology files and every lab already running on the machine.

</div>

![The topology editor in VS Code](../images/app/vscode-dark.webp#only-dark){ .shot }
![The topology editor in VS Code](../images/app/vscode-light.webp#only-light){ .shot }

Prefer video? Here is a [walkthrough of the extension on YouTube](https://www.youtube.com/watch?v=NIw1PbfCyQ4).

## Work from the editor

Topology files get containerlab actions in the editor title bar, the right-click menu, and the command palette. The keyboard shortcuts work in any open `.clab.yml` file:

| Action | Linux and Windows | macOS |
| --- | --- | --- |
| Deploy | ++ctrl+alt+d++ | ++cmd+alt+d++ |
| Redeploy | ++ctrl+alt+r++ | ++cmd+alt+r++ |
| Destroy | ++ctrl+alt+k++ | ++cmd+alt+k++ |
| Open the topology editor | ++ctrl+alt+g++ | ++cmd+alt+g++ |

Terminals for node shells and SSH open as VS Code terminals. Command output goes to the **Containerlab** output channel.

## Only in VS Code

- Sharing a running lab's terminals with SSHX or GoTTY.
- fcli helpers for SR Linux labs.
- Interactive Draw.io diagrams.

Every setting is listed in the [VS Code settings reference](../reference/vscode-settings.md). Open them with **Containerlab: Open Settings** from the command palette.

## If something is off

**No running labs appear.** VS Code is probably not connected to the machine running containerlab. Open the remote window with Remote SSH. If containerlab events do not reach the extension, set `containerlab.refreshMode` to `polling`.

**Interfaces are missing.** Labs deployed with containerlab older than 0.64.0 need a redeploy before interfaces and statistics show up.

**Packet capture does not open.** Docker must work on the machine running the extension. Check the [capture settings](../reference/vscode-settings.md#packet-capture) if your browser reaches the lab host under a different name.

<div class="next" markdown>
[:lucide-arrow-right: Run your first lab](../getting-started/first-lab.md)
[:lucide-arrow-right: Tour the workspace](../guides/workspace.md)
</div>
