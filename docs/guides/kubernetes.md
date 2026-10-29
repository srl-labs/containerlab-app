---
description: Run labs as pods on a Kubernetes cluster with clabernetes, from your own machine or through a lab host.
---

# Labs on Kubernetes

With [clabernetes](https://containerlab.dev/manual/clabernetes/) (c9s), a lab runs as pods on a Kubernetes cluster instead of containers on one machine. The apps show it like any other lab: the same topology file, the same canvas, terminals, and captures.
{ .lead }

## Two ways to reach a cluster

Only containerlab talks to clabernetes. Who runs containerlab, and with which Kubernetes identity, depends on how you reach the cluster:

| | Cluster on this machine | Through a lab host |
| --- | --- | --- |
| containerlab runs | on your machine, started by the app | inside `clab-api-server` |
| Kubernetes identity | whoever your kubeconfig signs in as | `clab:<user>`, the signed-in Linux user, impersonated by the server |
| Who holds a kubeconfig | you | only the server |
| Apps | VS Code, desktop; web for one user | VS Code, desktop, web |
| Your machine needs | Linux, containerlab, a kubeconfig | nothing but the app |
| Good for | you alone, with your own cluster rights | teams, browsers, macOS and Windows |

Either way, Kubernetes RBAC decides what works, and the cluster's audit log names the identity.

## Run labs from your machine

The app runs the containerlab CLI on your machine with `-r c9s` for deploy, destroy, inspect, apply, save, node start, stop and restart, logs, events, and capture. It never runs it with `sudo`, which would drop your kubeconfig. Terminals, browser ports, SSH, and node stats go straight to the cluster through the same kubeconfig and context.

You need:

- Linux, with containerlab 0.83.0 or later. See [Platforms](#platforms).
- A cluster with clabernetes 0.11.0 or later, installed with its lab roles (the ClusterRole `clabernetes-lab-editor`).
- A kubeconfig context for that cluster with the rights below.

### Kubeconfig and context

The app and containerlab look for the kubeconfig in this order:

1. the lab host's own kubeconfig file, when you set one (a leading `~` is your home folder),
2. `CLAB_KUBECONFIG`,
3. `KUBECONFIG`, which may list several files,
4. `~/.kube/config`.

The context is the lab host's `kubeContext`, else the kubeconfig's current context. The app hands both to containerlab as `CLAB_KUBECONFIG` and `CLAB_KUBE_CONTEXT`, so a cluster whose context lives in its own file works without `KUBECONFIG` in the app's environment.

### Namespaces and rights

| Namespace | What it takes | Your account needs |
| --- | --- | --- |
| One per lab, `c9s-<lab>` (default) | nothing to set | to create namespaces, and the `clabernetes-lab-editor` rights across the cluster |
| One fixed namespace for every lab | the lab host's `namespace` | a RoleBinding of `clabernetes-lab-editor` in that namespace |

Pick a fixed namespace when you may only use one. **Destroy** with cleanup deletes a lab's own `c9s-<lab>` namespace; a fixed namespace stays.

### What the app checks

Before it offers a cluster, the app checks it and shows each problem on the lab host, with what to do:

1. containerlab is 0.83.0 or later. Development builds pass.
2. The kubeconfig loads and has the context: *The kubeconfig has no context "X". Pick one of: …*
3. The cluster answers: *The cluster of context "X" does not answer: …*
4. clabernetes is installed: *clabernetes is not installed in the cluster of context "X" … Install clabernetes 0.11.0 or later.*
5. clabernetes is 0.11.0 or later, when your account may read its manager. containerlab checks the version again before it changes the cluster.
6. Your account may create Topologies, `pods/exec` and `pods/portforward`, read `pods/log`, and, with a namespace per lab, create namespaces: *Your account cannot create pods/exec in namespace X. Bind clabernetes-lab-editor in X.*

Fix what is listed and check again: **Check again** on the lab host under **Settings** > **Lab hosts** in the desktop app, or **Containerlab: Check Labs on This Machine** in VS Code.

### VS Code

<div class="steps" markdown>

1. **Run Containerlab: Add Lab Host…** from the command palette and choose **Kubernetes cluster (c9s)**.

2. **Pick the context.** The list shows the contexts of your default kubeconfig (`KUBECONFIG`, else `~/.kube/config`). For a context in another file, choose **Choose kubeconfig file…**, select the file, and pick one of its contexts; the lab host keeps the file.

3. **Enter a namespace**, or leave it empty for a namespace per lab.

</div>

The cluster shows in the explorer next to **Local**, with **Kubernetes** and its context in the description. When you deploy a topology from this machine, VS Code asks where: this machine or a cluster. It remembers the answer for that topology.

The cluster is kept in the `containerlab.connections` setting, next to the clab-api-server lab hosts:

```json
"containerlab.connections": [
  {
    "kind": "local",
    "runtime": "c9s",
    "kubeContext": "lab-prod",
    "kubeconfig": "~/.kube/lab-prod.yaml",
    "namespace": "team-a",
    "label": "Lab prod"
  }
]
```

Only `kind`, `runtime` and `kubeContext` are required; the others are described in the [settings reference](../reference/vscode-settings.md#lab-hosts). `containerlab.binaryPath` names the containerlab to run.

### Desktop app

List clusters under `clusters` in `~/.config/Containerlab/local-backend.json`:

```json
{
  "clusters": [
    { "kubeContext": "lab-prod", "kubeconfig": "~/.kube/lab-prod.yaml", "namespace": "team-a", "label": "Lab prod" },
    { "kubeContext": "kind-dev" }
  ]
}
```

Each entry takes `kubeContext` and optionally `kubeconfig`, `namespace`, `exposeType`, `persistence`, and `label`. Restart the app after a change. A cluster that passes the checks shows up next to **This computer**; one that does not is listed under **Settings** > **Lab hosts** with what is missing.

To make the app's own lab host a cluster instead of this computer's Docker, start it with `CONTAINERLAB_DESKTOP_RUNTIME=c9s` and `CONTAINERLAB_DESKTOP_KUBE_CONTEXT`; see the [desktop settings](../reference/app-settings.md#desktop-app).

### Web app, for one user

The web app normally reaches clusters [through a lab host](#run-labs-through-a-lab-host). For a personal setup it can run labs itself: `WEB_LOCAL_LABS=true` with `WEB_LOCAL_RUNTIME=c9s`, and `WEB_LOCAL_KUBECONFIG` and `WEB_LOCAL_KUBE_CONTEXT` for the cluster. In a pod without a kubeconfig, it uses the pod's ServiceAccount. Everyone who can open the app then works with that one identity, without signing in. See the [web settings](../reference/app-settings.md#web-app).

## Run labs through a lab host

With `CLAB_RUNTIME=c9s`, `clab-api-server` runs the labs of everyone who signs in on one cluster. Users sign in with their Linux account as on any [lab host](../install/sign-in.md) and never get a kubeconfig; the browser never talks to Kubernetes.

- The server holds one kubeconfig, for its own ServiceAccount, which may only set up lab namespaces and act as users.
- On a user's first deploy of a lab, the server creates the namespace `c9s-<user>-<lab>` and binds `clabernetes-lab-editor` in it to `clab:<user>`.
- Every lab action then runs as `clab:<user>` in the group `clab:users`; members of `SUPERUSER_GROUP` also get `clab:admins`. A user can do through the server what `kubectl` would let that user do.

The lab host shows **Kubernetes** in its description. A clab-api-server that does not report its runtime is older than c9s support and shows *Update it to 0.10.0 or later*.

To set up the server, its ServiceAccount, and the roles, see [Running on Kubernetes](https://github.com/srl-labs/clab-api-server/blob/main/docs/kubernetes.md) in the clab-api-server repository.

## Platforms

containerlab runs on Linux only, so a cluster on this machine needs Linux too, even though the lab runs elsewhere:

- **Linux**: VS Code and the desktop app.
- **Windows**: VS Code connected to WSL, or the Linux desktop app inside WSL.
- **macOS**: a Linux VM.

Elsewhere, the apps do not offer a cluster on this machine: VS Code's **Add Lab Host** adds clab-api-servers only and leaves configured clusters out, and the desktop app skips the `clusters` of `local-backend.json`. Both say *containerlab runs on Linux only. Use a clab-api-server lab host, or run the app in WSL or a Linux VM.* (VS Code in its output channel, the desktop app in its log). Reach the cluster [through a lab host](#run-labs-through-a-lab-host) instead.

## What changes on a cluster

- Nodes are pods. The node panel shows each node's namespace, pod, container, and exposed ports, and a `kubectl exec` command to copy; it names the lab host's context and kubeconfig file.
- **Run with options** offers the c9s deploy options: **Namespace**, **Expose ports**, **No persistent volumes**, and **Image pull secret**.
- What a cluster has no use for is hidden: image management, link impairments, VM snapshots, pausing nodes, fcli, Edgeshark, SSHX and GoTTY sharing, and host stats. Node stats need `metrics.k8s.io` in the cluster.
- Packet captures come from clabernetes as one pcapng stream; see [Labs on a Kubernetes cluster](labs.md#labs-on-a-kubernetes-cluster) for where they open in each app.

<div class="next" markdown>
[:lucide-arrow-right: Run a lab](labs.md)
[:lucide-arrow-right: Set up a lab host](../install/lab-host.md)
</div>
