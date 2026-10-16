---
description: Install the containerlab extension for VS Code and run labs locally, in WSL, over Remote SSH, or on a lab server through clab-api-server.
---

# VS Code extension

The extension puts the topology editor and the lab explorer inside VS Code. It runs containerlab on the machine it runs on, or works with labs on a lab server through `clab-api-server`.
{ .lead }

<figure class="diagram" markdown>

```clab file="diagrams/vscode-host.clab.yml" annotations="diagrams/vscode-host.clab.yml.annotations.json" title="Where the VS Code extension runs" height="320" borderless="true" zoom="false" fit-padding="0.1"
```

<figcaption>Labs run wherever the extension runs. With Remote SSH, that is the server, not your laptop.</figcaption>
</figure>

## Prepare the lab machine

To run labs where VS Code runs, on the Linux machine (or WSL distribution):

- [Install containerlab](https://containerlab.dev/install/). The extension offers to install it when it cannot find the binary.
- Make sure Docker works for your user.
- Run VS Code as root, or add your user to the `clab_admins` and `docker` groups.

For labs on a lab server with `clab-api-server`, skip this and [work with labs on a lab server](#work-with-labs-on-a-lab-server). For a remote server without it, install the [Remote SSH extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh) on your laptop and connect to the server first. Everything below then happens on the server.

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

## Work with labs on a lab server

The extension can also manage labs on a [lab host](lab-host.md) that runs `clab-api-server`, without containerlab or Docker on your machine. This works from Linux, macOS, and Windows.

<div class="steps" markdown>

1. **Add the server.** Run **Containerlab: Add Lab Server…** from the command palette and enter the API server URL, for example `https://lab1.example.com:8090`, and a name.

2. **Sign in** with your Linux account on the lab host. It must be in the `clab_api` or `clab_admins` group, as for the [desktop and web apps](sign-in.md).

3. **Switch** between **Local** and your lab servers with the cloud button in the explorer title bar, or the lab server entry in the status bar. The explorer shows the labs of the active one.

</div>

The servers are kept in the `containerlab.connections` setting, so you can also add them there, for a whole team in workspace settings:

```json
"containerlab.connections": [
  { "label": "lab1", "url": "https://lab1.example.com:8090", "username": "alice" }
]
```

Passwords never go into settings. Signing in exchanges the password for a session token, which VS Code keeps in its secret storage, so you stay signed in after a restart until the session ends. **Containerlab: Sign Out of Lab Server** forgets it.

On a lab server:

- **Files** live in your workspace on the server (`~/.clab`). The explorer lists the topologies there; they open as `clab-api://` files in the normal text editor and in the topology editor, and save back to the server. **Containerlab: Open Lab Server Workspace** adds the whole workspace to the Explorer view.
- **Deploy, destroy, apply, start, stop, save** and the other lab actions run on the server, with the output in the **Containerlab** output channel.
- **Shell, SSH, and telnet** open as VS Code terminals connected through the API server. **Logs** open in an editor.
- **Packet capture** runs Wireshark in a container on the server and shows it in a VS Code tab; Edgeshark links point at the server.
- **Clone repository from git** and **Deploy lab file** with a Git URL clone into the server's workspace. The server takes GitHub and GitLab URLs.

Turn off `containerlab.localConnection` to hide **Local** when you only work on lab servers. Like the desktop app, the extension accepts the API server's self-signed certificate; start VS Code with `CLAB_API_TLS_VERIFY=true` to require a trusted one.

## Only in VS Code

- Sharing a running lab's terminals with SSHX or GoTTY.
- fcli helpers for SR Linux labs.
- Interactive Draw.io diagrams.

Every setting is listed in the [VS Code settings reference](../reference/vscode-settings.md). Open them with **Containerlab: Open Settings** from the command palette.

## If something is off

**No running labs appear.** VS Code is probably not connected to the machine running containerlab. Open the remote window with Remote SSH, or add the machine as a lab server. If containerlab events do not reach the extension, set `containerlab.refreshMode` to `polling`.

**A lab server shows no labs.** The status bar reads **Sign In** when the session has ended; select it to sign in again. Check that the server is reachable from your machine, as described in [If sign-in fails](sign-in.md#if-sign-in-fails).

**Interfaces are missing.** Labs deployed with containerlab older than 0.64.0 need a redeploy before interfaces and statistics show up.

**Packet capture does not open.** For local labs, Docker must work on the machine running the extension. On a lab server, Edgeshark must run there: **Containerlab: Install Edgeshark** installs it while the lab server is active. Check the [capture settings](../reference/vscode-settings.md#packet-capture) if your browser reaches the lab host under a different name.

<div class="next" markdown>
[:lucide-arrow-right: Run your first lab](../getting-started/first-lab.md)
[:lucide-arrow-right: Tour the workspace](../guides/workspace.md)
</div>
