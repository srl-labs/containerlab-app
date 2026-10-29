---
description: Install the containerlab extension for VS Code and run labs locally, in WSL, over Remote SSH, or on lab hosts through clab-api-server.
---

# VS Code extension

The extension puts the topology editor and the lab explorer inside VS Code. It runs containerlab on the machine it runs on, and shows the labs of lab hosts running `clab-api-server` next to them.
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

For labs on a lab host with `clab-api-server`, skip this and [work with labs on a lab host](#work-with-labs-on-a-lab-host). For a remote server without it, install the [Remote SSH extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-ssh) on your laptop and connect to the server first. Everything below then happens on the server.

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

## Work with labs on a lab host

The extension can also manage labs on a [lab host](lab-host.md) that runs `clab-api-server`, without containerlab or Docker on your machine. This works from Linux, macOS, and Windows.

<div class="steps" markdown>

1. **Open the Lab Hosts page.** Select the server button in the explorer title bar, or run **Containerlab: Manage Lab Hosts** from the command palette.

2. **Add the lab host** with its API Server URL, for example `https://lab1.example.com:8090`, a name, and your Linux account on it. The account must be in the `clab_api` or `clab_admins` group, as for the [desktop and web apps](sign-in.md). The host is saved once the sign-in works.

3. **Find its labs in the explorer.** Running Labs and Undeployed Labs each list **This computer** and every lab host, with a dot for its status. Every action runs on the host the lab belongs to.

</div>

![Lab hosts next to This computer in the explorer, and the Lab Hosts page](../images/app/vscode-lab-hosts-dark.webp#only-dark){ .shot }
![Lab hosts next to This computer in the explorer, and the Lab Hosts page](../images/app/vscode-lab-hosts-light.webp#only-light){ .shot }

The Lab Hosts page shows each host's status, CPU, memory, and disk, and signs in, signs out, edits, or removes it. In the explorer, right-click a lab host for the same actions and more: deploy a lab file, clone a repository, manage images, install Edgeshark, or open its files. **Containerlab: Add Lab Host…** adds one from the command palette, step by step.

The lab hosts are kept in the `containerlab.connections` setting, so you can also add them there, for a whole team in workspace settings:

```json
"containerlab.connections": [
  { "label": "lab1", "url": "https://lab1.example.com:8090", "username": "alice", "sessionDuration": "24h" }
]
```

Passwords never go into settings. Signing in exchanges the password for a session token, which VS Code keeps in its secret storage, so you stay signed in after a restart until the session ends. When it ends, the lab host's dot turns yellow; select the host to sign in again.

On a lab host:

- **Files** live in your workspace on the host (`~/.clab`). The explorer lists the topologies there; they open as `clab-api://` files in the normal text editor and in the topology editor, and save back to the host. **Open Files in Explorer** adds the whole workspace to the Explorer view.
- **Deploy, destroy, apply, start, stop, save** and the other lab actions run on the host, with the output in the **Containerlab** output channel.
- **Shell, SSH, and telnet** open as VS Code terminals connected through the API Server. **Logs** open in an editor.
- **Packet capture** runs Wireshark in a container on the host and shows it in a VS Code tab; Edgeshark links point at the host.
- **Clone repository** and **Deploy lab file** with a Git URL clone into the host's workspace. The host takes GitHub and GitLab URLs.
- **Image completion** in topology files and the topology editor offers the host's images.

**Add Lab Host** asks where labs should run: **This computer**, **Kubernetes**, or **API Server**. To run labs on a Kubernetes cluster with clabernetes from this machine, choose **Kubernetes**: the cluster form opens on the Lab Hosts page, with **Check connection**. See [Labs on Kubernetes](../guides/kubernetes.md#add-a-cluster).

**This computer** is listed when containerlab can run where VS Code runs. When something is missing there, its dot turns red and its tooltip says what to fix; **Check Again** looks again once you fixed it. To work with lab hosts only, hide **This computer** on the Lab Hosts page, or turn off `containerlab.localConnection`. Like the desktop app, the extension accepts the API Server's self-signed certificate; start VS Code with `CLAB_API_TLS_VERIFY=true` to require a trusted one.

## Only in VS Code

- Sharing a running lab's terminals with SSHX or GoTTY.
- fcli helpers for SR Linux labs.
- Interactive Draw.io diagrams.

Every setting is listed in the [VS Code settings reference](../reference/vscode-settings.md). Open them with **Containerlab: Open Settings** from the command palette.

## If something is off

**No running labs appear.** VS Code is probably not connected to the machine running containerlab. Open the remote window with Remote SSH, or add the machine as a lab host. If containerlab events do not reach the extension, set `containerlab.refreshMode` to `polling`.

**A lab host shows no labs.** A yellow dot means its sign-in ended; select the host to sign in again. A red dot means it does not answer: check that it is reachable from your machine, as described in [If sign-in fails](sign-in.md#if-sign-in-fails).

**Interfaces are missing.** Labs deployed with containerlab older than 0.64.0 need a redeploy before interfaces and statistics show up.

**Packet capture does not open.** For local labs, Docker must work on the machine running the extension. On a lab host, Edgeshark must run there: right-click the host in the explorer and select **Install EdgeShark**. Check the [capture settings](../reference/vscode-settings.md#packet-capture) if your browser reaches the lab host under a different name.

<div class="next" markdown>
[:lucide-arrow-right: Run your first lab](../getting-started/first-lab.md)
[:lucide-arrow-right: Tour the workspace](../guides/workspace.md)
</div>
