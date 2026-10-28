---
description: Run labs as pods on a Kubernetes cluster with clabernetes, from your own machine or through a lab server.
---

# Labs on Kubernetes

With [clabernetes](https://containerlab.dev/manual/clabernetes/) (c9s), a lab runs as pods on a Kubernetes cluster instead of containers on one machine. The apps show it like any other lab: the same topology file, the same canvas, terminals, and captures.
{ .lead }

## Two ways to reach a cluster

Only containerlab talks to clabernetes. Who runs containerlab, and with which Kubernetes identity, depends on how you reach the cluster:

Every app adds both the same way: **Add lab host** asks *Where should labs run?* and offers **This computer** (Docker or Podman), **Kubernetes cluster** (your kubeconfig; containerlab runs on this computer), and **Lab server** (`clab-api-server`, which may run Docker or Kubernetes). A choice that cannot work in the app stays in the list, greyed, with the reason and what to do instead.

| | Kubernetes cluster | Lab server that runs Kubernetes |
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

### Add a cluster

In VS Code and the desktop app:

<div class="steps" markdown>

1. **Open Add lab host.** In VS Code: **Containerlab: Add Lab Host…** from the command palette, or **Settings** > **Lab hosts**. In the desktop app: **Settings** > **Lab hosts**, or **Add Lab Host** in the explorer. Choose **Kubernetes cluster**.

2. **Pick the kubeconfig and context.** The form starts with your default kubeconfig (`KUBECONFIG`, else `~/.kube/config`) and its current context. **Choose file…** picks another file; the lab host keeps its path. The **Context** list shows each context with its cluster and marks the current one.

3. **Choose the namespaces**: one per lab (`c9s-<lab>`), or one fixed namespace for every lab.

4. **Set the deploy defaults** every deploy on this cluster uses unless **Deploy with options** changes them:
    - **Port exposure**: *None* (reach nodes through the app: terminals and port forwards), *ClusterIP* (a Service per node inside the cluster), *Headless* (DNS names per node), or *LoadBalancer* (an address per node from outside the cluster). Empty keeps clabernetes' default.
    - **Persistent node storage**: on, nodes keep their saved configuration and files when their pod is replaced and across **Destroy** without cleanup; off, every restart starts them from their startup config.
    - **Image pull secret**: a Secret in the lab's namespace for private registries.

5. **Check connection**, then **Add cluster**.

</div>

The cluster shows next to **This computer** (**Local** in VS Code), with *Kubernetes · `<context>` · one namespace per lab* (or the namespace) under its name. **Edit** opens the same form; **Remove** forgets the cluster and leaves its labs running.

When you deploy a topology from this computer in VS Code and clusters exist, VS Code asks where: this computer or a cluster. It remembers the answer for that topology.

### Check connection

**Check connection**, in the form and on every lab host on this computer, runs these checks and lists each with ✓, ✗, or – (not run, because an earlier one failed), what it found, and how to fix a failure:

1. containerlab is 0.83.0 or later. Development builds pass.
2. The kubeconfig loads and has the context.
3. The cluster answers.
4. clabernetes 0.11.0 or later is installed. When your account may not read its manager, the check passes and containerlab checks the version before it changes the cluster.
5. Your account may create Topologies, `pods/exec` and `pods/portforward`, read `pods/log`, and, with a namespace per lab, create namespaces.

A missing right comes with the command a cluster admin runs, for the user the cluster sees you as, for example:

```bash
kubectl create rolebinding clab-lab-editor-alice --clusterrole clabernetes-lab-editor --user alice -n team-a
```

A lab host whose checks fail stays in the list with the failed checks, so you can fix or edit it.

### Where it is kept

VS Code keeps a cluster in the `containerlab.connections` setting, next to the lab servers:

```json
"containerlab.connections": [
  {
    "kind": "kubernetes",
    "kubeContext": "lab-prod",
    "kubeconfig": "~/.kube/lab-prod.yaml",
    "namespace": "team-a",
    "exposeType": "None",
    "imagePullSecret": "regcred",
    "label": "Lab prod"
  }
]
```

Only `kind` and `kubeContext` are required; see the [settings reference](../reference/vscode-settings.md#lab-hosts). Entries with `"kind": "local", "runtime": "c9s"` from earlier versions keep working. `containerlab.runtime` (`docker` or `podman`) is the runtime of this computer only; `containerlab.binaryPath` names the containerlab to run.

The desktop app keeps clusters under `clusters` in `~/.config/Containerlab/local-backend.json` and writes the file itself when you add, edit, or remove one:

```json
{
  "clusters": [
    { "kubeContext": "lab-prod", "kubeconfig": "~/.kube/lab-prod.yaml", "namespace": "team-a", "label": "Lab prod" },
    { "kubeContext": "kind-dev", "persistence": false }
  ]
}
```

To make the app's own lab host a cluster instead of this computer's Docker, start it with `CONTAINERLAB_DESKTOP_RUNTIME=c9s` and `CONTAINERLAB_DESKTOP_KUBE_CONTEXT`; see the [desktop settings](../reference/app-settings.md#desktop-app). That host is set by the environment and cannot be edited in the app.

### Web app

The browser never receives or uploads a kubeconfig, so **Add lab host** in the web app shows **Kubernetes cluster** greyed, with how the server adds one. The web app normally reaches clusters [through a lab server](#run-labs-through-a-lab-server). For a personal setup its server can run labs itself: `WEB_LOCAL_LABS=true` with `WEB_LOCAL_RUNTIME=c9s`, and `WEB_LOCAL_KUBECONFIG` and `WEB_LOCAL_KUBE_CONTEXT` for the cluster (`WEB_LOCAL_KUBE_NAMESPACE`, `WEB_LOCAL_C9S_EXPOSE_TYPE`, `WEB_LOCAL_C9S_PERSISTENCE` and `WEB_LOCAL_C9S_IMAGE_PULL_SECRET` set the defaults). The cluster then shows in the list with its details and **Check connection**. In a pod without a kubeconfig, it uses the pod's ServiceAccount. Everyone who can open the app works with that one identity, without signing in. See the [web settings](../reference/app-settings.md#web-app).

## Run labs through a lab server

With `CLAB_RUNTIME=c9s`, `clab-api-server` runs the labs of everyone who signs in on one cluster. Add it with **Add lab host** > **Lab server** and sign in with your Linux account as on any [lab server](../install/sign-in.md); you never get a kubeconfig, and the browser never talks to Kubernetes.

- The server holds one kubeconfig, for its own ServiceAccount, which may only set up lab namespaces and act as users.
- On a user's first deploy of a lab, the server creates the namespace `c9s-<user>-<lab>` and binds `clabernetes-lab-editor` in it to `clab:<user>`.
- Every lab action then runs as `clab:<user>` in the group `clab:users`; members of `SUPERUSER_GROUP` also get `clab:admins`. A user can do through the server what `kubectl` would let that user do.

Once you are signed in, the lab host shows what the server runs: *Lab server · Kubernetes · cluster `<cluster>` · namespaces `c9s-<user>-{lab}`*, and the server's deploy settings, *Set by the lab server: ports exposed: None · node storage kept · no image pull secret*. These are the server's policy: **Deploy with options** shows them read-only instead of fields the server would ignore. A server without the `lab-host-info` feature shows only *Kubernetes*; one that does not report its runtime at all is older than c9s support and shows *Update it to 0.10.0 or later*.

To set up the server, its ServiceAccount, and the roles, see [Running on Kubernetes](https://github.com/srl-labs/clab-api-server/blob/main/docs/kubernetes.md) in the clab-api-server repository.

## Platforms

containerlab runs on Linux only, so a cluster on this machine needs Linux too, even though the lab runs elsewhere:

- **Linux**: VS Code and the desktop app.
- **Windows**: VS Code connected to WSL, or the Linux desktop app inside WSL.
- **macOS**: a Linux VM.

Elsewhere, **Add lab host** shows **This computer** and **Kubernetes cluster** greyed with *containerlab runs on Linux only*, and how to go on: use a lab server, or open the window in WSL. Clusters already configured are left out (VS Code says so in its output channel, the desktop app in its log). Reach the cluster [through a lab server](#run-labs-through-a-lab-server) instead.

## What changes on a cluster

- Nodes are pods. The node panel shows each node's namespace, pod, container, and exposed ports, and a `kubectl exec` command to copy; it names the lab host's context and kubeconfig file.
- **Run with options** offers the c9s deploy options: **Namespace**, **Expose ports**, **No persistent volumes**, **Image pull secret**, and **Without a Topology resource**, next to **Timeout** (containerlab's default on a cluster is 10m; raise it when big images pull slowly) and **Max workers** (Kubernetes requests sent in parallel). Each shows the cluster's default; a plain deploy uses the defaults. On a lab server the c9s options show read-only, as set by the server, and there is no timeout: the server takes none.
- [**Lab settings…**](labs.md#lab-settings) keeps these options for one lab on the cluster, so its redeploys, applies, and destroys use the same namespace, timeout, and storage.
- What a cluster has no use for is hidden: image management, link impairments, VM snapshots, pausing nodes, fcli, Edgeshark, SSHX and GoTTY sharing, and host stats. Node stats need `metrics.k8s.io` in the cluster. Image management in particular: the cluster's nodes pull images themselves, so for a private registry set an image pull secret instead.
- Packet captures come from clabernetes as one pcapng stream; see [Labs on a Kubernetes cluster](labs.md#labs-on-a-kubernetes-cluster) for where they open in each app. Wireshark VNC of a cluster on this machine runs its container on this machine's Docker, not in the cluster, and the app writes the capture into it: it needs Docker here and a wireshark-vnc-docker image with the capture pipe, but no permission to create pods.

<div class="next" markdown>
[:lucide-arrow-right: Run a lab](labs.md)
[:lucide-arrow-right: Set up a lab server](../install/lab-host.md)
</div>
