---
description: Every setting of the containerlab VS Code extension, with defaults.
---

# VS Code settings

All settings live under `containerlab.`. Open them with **Containerlab: Open Settings** from the command palette, or the gear in the explorer title bar.
{ .lead }

The settings tab edits **User** or **Workspace** scope and stays in sync with VS Code's own settings. **Reset** removes an override. Appearance changes apply right away; runtime settings tell you when a window reload is needed.

Its menu has the app's own settings under **App**, then each lab host under **Lab hosts**, then **Add lab host**. Settings that depend on where labs run are on the lab host's page, each in one place: see [Lab host settings](#lab-host-settings).

## Appearance

| Setting | Default | What it does |
| --- | --- | --- |
| `appearance.colorScheme` | `vscode` | Follow VS Code, or force light or dark in containerlab views. |
| `appearance.fontSize` | `0` | Interface font size, 10–24 px. `0` follows VS Code. Topology labels and terminals keep their size. |
| `appearance.fontFamily` | empty | Interface font. Empty follows VS Code. |
| `appearance.reduceMotion` | `false` | Minimize animations and transitions. |

## Lab hosts

Each lab host's page in the settings tab, and **Add lab host**, manage these; see [Work with labs on a lab host](../install/vscode.md#work-with-labs-on-a-lab-host).

| Setting | Default | What it does |
| --- | --- | --- |
| `connections` | `[]` | Lab hosts. A `clab-api-server` entry has `url`, and optionally `label`, `username`, and `sessionDuration`; passwords and tokens are never stored here. A [Kubernetes](../guides/kubernetes.md#add-a-cluster) entry has `"kind": "kubernetes"` and `kubeContext`, and optionally `kubeconfig` (the file with the context; a leading `~` is your home folder), `namespace` (one for every lab instead of `c9s-<lab>`), the deploy defaults `exposeType` (`ClusterIP`, `Headless`, `LoadBalancer`, or `None`), `persistence` (`false` keeps no node storage) and `imagePullSecret`, and `label`. The settings on its page add `deployTimeout`, `noTopologyCR`, `deployExtraArgs`, `destroyExtraArgs`, `captureMethod` and `wiresharkImage`; an API Server's page adds `captureMethod`. **Add Lab Host** > **Kubernetes** writes it for you. Entries with `"kind": "local", "runtime": "c9s"` from earlier versions keep working. Clusters need Linux or WSL, where containerlab runs. |
| `localConnection` | `true` | Show **This computer**, the labs on the machine VS Code runs on, next to the lab hosts. |

## General

| Setting | Default | What it does |
| --- | --- | --- |
| `refreshMode` | `events` | `events` follows `containerlab events` live. `polling` runs `containerlab inspect` every `pollInterval`. |
| `pollInterval` | `5000` | Polling interval in ms. |
| `enableInterfaceStats` | `true` | Interface counters in the explorer. Turn off to save resources. |
| `skipCleanupWarning` | `false` | Skip the confirmation for cleanup actions. |
| `skipUpdateCheck` | `false` | Do not check for containerlab updates at start. |
| `showWelcomePage` | `true` | Show the welcome page when the extension starts. |

## Editor

| Setting | Default | What it does |
| --- | --- | --- |
| `editor.customNodes` | SR Linux and Network Multitool | Your [node templates](../guides/templates.md). |
| `editor.lockLabByDefault` | `true` | Open labs locked. |
| `editor.updateLinkEndpointsOnKindChange` | `true` | Rename link endpoints when a node's kind changes. |

A template can hold a full node definition:

```json
{
  "containerlab.editor.customNodes": [
    {
      "name": "SR Linux",
      "kind": "nokia_srlinux",
      "type": "ixr-d1",
      "image": "ghcr.io/nokia/srlinux:latest",
      "icon": "router",
      "baseName": "srl",
      "interfacePattern": "e1-{n}",
      "setDefault": true
    }
  ]
}
```

## Node actions

| Setting | Default | What it does |
| --- | --- | --- |
| `node.execCommandMapping` | `{}` | Command to run per kind when you open a shell. |
| `node.sshUserMapping` | `{}` | SSH user per kind. A `credentials` username in the topology takes precedence. |
| `node.telnetPort` | `5000` | Port for the Telnet action. |

```json
{
  "containerlab.node.execCommandMapping": { "nokia_srlinux": "sr_cli", "arista_ceos": "Cli" },
  "containerlab.node.sshUserMapping": { "nokia_srlinux": "admin", "cisco_xrd": "clab" }
}
```

## Packet capture

These apply to every lab host: they are about Wireshark on this computer.

| Setting | Default | What it does |
| --- | --- | --- |
| `capture.wireshark.path` | empty | Wireshark for captures from Kubernetes (c9s) lab hosts, which pipe the capture into `wireshark -k -i -`; found on `PATH` or where it installs when empty. |
| `capture.wireshark.theme` | `Follow VS Code theme` | Wireshark color scheme. |
| `capture.wireshark.stayOpenInBackground` | `true` | Keep sessions alive in background tabs. Uses more memory. |

## Lab host settings

Each lab host's page has the same sections: **Containerlab**, **Connection**, **Deploy defaults** and **Capture**. A setting that does not apply to the kind of lab host is greyed out with the reason; what an API Server decides itself shows read-only, marked **Set by the API Server**. A value you set for one lab host shows **changed for this host** and **Reset**; the default shows in the empty field.

**This computer** keeps its values in these settings, as before:

| Setting | Default | What it does |
| --- | --- | --- |
| `runtime` | `docker` | Container runtime: `docker` or `podman`. A Kubernetes cluster is a lab host of its own; add it with **Add Lab Host** > **Kubernetes**. |
| `dockerSocketPath` | `/var/run/docker.sock` | Docker or Podman socket, e.g. `/run/user/1000/podman/podman.sock`. |
| `binaryPath` | empty | Absolute path to `containerlab`. Empty looks it up in `PATH`. Kubernetes lab hosts use it too: containerlab on this computer deploys their labs. |
| `deploy.timeout` | empty | containerlab's `--timeout` for deploys, redeploys and applies that set none, e.g. `5m`. Empty keeps containerlab's 2m. A lab's own timeout (**Lab settings** > **Deploy**) wins. |
| `deploy.extraArgs` | empty | Extra flags for every deploy and redeploy. |
| `destroy.extraArgs` | empty | Extra flags for every destroy. |
| `capture.preferredAction` | `Automatic` | Where a capture opens: `Automatic`, `Wireshark on this computer`, `Wireshark VNC` or `Edgeshark`. When the lab host lacks the pick, the capture opens the automatic way and says why; see [Default capture method](../guides/labs.md#default-capture-method). |
| `capture.wireshark.dockerImage` | `ghcr.io/srl-labs/wireshark-vnc-docker:latest` | Image for Wireshark VNC sessions. |
| `capture.wireshark.pullPolicy` | `always` | `always`, `missing`, or `never`. |
| `capture.wireshark.vncCaptureHostname` | empty | Host name override for VNC capture URIs only. |
| `capture.remoteHostname` | empty | Host name or IP your machine uses to reach Edgeshark. |
| `capture.packetflixPort` | `5001` | Packetflix WebSocket port used by Edgeshark. |
| `capture.edgeshark.extraEnvironmentVars` | `HTTP_PROXY=, http_proxy=` | Comma-separated variables for the Edgeshark containers. |

A **Kubernetes** lab host keeps its own in its `connections` entry: `deployTimeout` (containerlab's 10m when unset), the deploy defaults `exposeType`, `persistence`, `imagePullSecret` and `noTopologyCR` (deploy without clabernetes' Topology resource), `deployExtraArgs`, `destroyExtraArgs`, `captureMethod` and `wiresharkImage` (it needs the capture pipe, `CLABWIRE_CAPTURE_PIPE`, of wireshark-vnc-docker). Its container runtime, socket and Edgeshark settings are greyed out: the cluster runs the nodes as pods, and clabernetes captures lab links as one stream.

An **API Server** keeps `captureMethod` in its entry. Its runtime, cluster, namespaces, deploy defaults and timeout show as the server reports them.

Earlier versions applied `deploy.extraArgs`, `destroy.extraArgs`, `capture.preferredAction` and `capture.wireshark.dockerImage` to every lab host. The first start of this version copies the values you set into the Kubernetes lab hosts and API Servers they applied to (the image and arguments only to Kubernetes lab hosts), so your labs deploy and capture as before.

## Extras

| Setting | Default | What it does |
| --- | --- | --- |
| `drawioDefaultTheme` | `nokia_modern` | Draw.io theme: `nokia_modern`, `nokia`, or `grafana`. |
| `gotty.port` | `8080` | Port for GoTTY terminal sharing. |
| `extras.fcli.extraDockerArgs` | empty | Extra Docker or Podman flags for fcli. |
