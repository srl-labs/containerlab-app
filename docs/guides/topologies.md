---
description: Add nodes, connect interfaces, and edit the topology on the canvas or as YAML.
---

# Build a topology

Draw it or type it. The canvas and the YAML are two views of the same file, and every change shows up in both.
{ .lead }

<figure class="diagram" markdown>

```clab file="examples/fabric.clab.yml" annotations="examples/fabric.clab.yml.annotations.json" title="Leaf–spine fabric" height="380" borderless="true"
```

<figcaption>Every leaf connects to both spines. Scroll to zoom, drag to pan.</figcaption>
</figure>

Unlock the canvas first: select the lock in the toolbar.

## Add nodes

- **Drag a template** from the **Palette** onto the canvas.
- **++shift++ + click** an empty spot to drop your default template there.
- **Copy and paste** existing nodes with ++ctrl+c++ and ++ctrl+v++, or duplicate with ++ctrl+d++.

Names count up from the template's base name: `srl1`, `srl2`, `srl3`. To make your own templates, see [Node templates](templates.md).

## Connect interfaces

**++shift++ + click** the first node, then click the second. The editor picks the next free interface on each side, following the node kind's naming, for example `e1-1` on SR Linux and `eth1` on Linux.

Double-click a link to change its interfaces or properties in the **Link Editor**. On the **Extended** tab, **Type** switches a link between `veth` and `veth-stitch`. A [`veth-stitch`](https://containerlab.dev/manual/topo-def-file/#veth-stitch) link joins the two nodes through veth pairs on the host, so you can capture and impair it there even when a node can't be impaired itself. containerlab already deploys brief links to SR-SIM nodes this way.

## Connect many at once

**Bulk Link Devices** connects every node matching a **Source Pattern** to every node matching a **Target Pattern**.

| Source | Target | Result |
| --- | --- | --- |
| `leaf*` | `spine*` | A full mesh between leaves and spines |
| `srl?` | `client` | `srl1` to `srl9` each connect to `client` |
| `leaf(\d+)` | `server$1` | `leaf1`–`server1`, `leaf2`–`server2`, … |

![Bulk Link Devices](../images/app/bulk-link-dark.webp#only-dark){ .shot .narrow }
![Bulk Link Devices](../images/app/bulk-link-light.webp#only-light){ .shot .narrow }

## Edit node properties

Double-click a node to open the **Node Editor**: kind, type, image, startup config, binds, environment, ports, and the rest of what containerlab supports.

![Node Editor](../images/app/node-editor-dark.webp#only-dark){ .shot }
![Node Editor](../images/app/node-editor-light.webp#only-light){ .shot }

A value the node gets from `defaults`, its kind, or its group shows where it comes from under the field, for example *From kind nokia_srlinux*. Type a new value to override it for this node, or clear the field to go back to the inherited one. Inherited environment variables, labels, binds, and exec commands are locked: change them where they are set. **Settings Group** picks the containerlab `group` the node inherits from. It is not the same as a group drawn on the canvas.

## Share settings between nodes

**Lab Settings** → **Defaults & Groups** lists the lab's `defaults`, `kinds`, and `groups`, with the number of nodes each one reaches. Edit one to open the same tabs as the Node Editor, add a kind or a group, or remove one. These edits save right away.

containerlab applies them in order: `defaults`, then the node's kind, then its group, then the node itself. Environment variables, labels, binds, exec commands, and similar lists add up across levels; other values come from the most specific level that sets them.

## Lab-wide settings

**Lab Settings** → **Management** sets the [management network](https://containerlab.dev/manual/network/#management-network): its name, driver, subnets, and options. Add networks to give nodes separate ones; the first is the default.

**Tailscale** joins a management network to a [Tailscale](https://containerlab.dev/manual/network/#tailscale) tailnet, on one network per lab:

- **Sidecar per node** adds every node as a device of its own. It needs an auth key; write it as an environment variable such as `${TS_AUTHKEY}` to keep it out of the file.
- **Lab proxy** adds the lab as one device that you log in to with SSO. It forwards the node ports set to **Tailscale** in the Node Editor's **Port Mappings**, written as `8022:22/ts`.

While the lab runs on a clab-api-server, the tab lists its Tailscale devices, their tailnet addresses and forwarded ports, and the login link the proxy waits on. Labs on the local containerlab don't show this list.

**Lab Settings** → **Certificates** sets the [certificate authority](https://containerlab.dev/manual/cert/) that signs node certificates: the key size and validity of the CA containerlab generates, or the certificate and key files of your own CA.

## Kind-specific settings

Some kinds take [settings of their own](https://containerlab.dev/manual/nodes/#kind-specific-config). The **Kind** tab of the Node Editor shows the ones the node's kind accepts, for example:

| Kind | Settings |
| --- | --- |
| `nokia_srlinux` | Custom prompt, EDA gRPC server, line cards (`components`) |
| `nokia_sros`, `nokia_srsim` | Config mode, component config generation |
| `cisco_iol` | PID offset, management interface, bootstrap config |
| `arista_ceos` | Copy to flash |
| `frr`, `frrouting` | Daemons |
| `k8s-kind` | Kubeconfig path, wait time |
| `nvidia_cumulusvx` | Port count, breakouts |

The fields come from the containerlab schema, so new kinds and settings appear once the app ships the newer schema. Kinds without such settings have no **Kind** tab. If you change a node's kind, settings the new kind doesn't accept are removed, since containerlab won't deploy the node with them.

`nokia_sros` and `nokia_srsim` nodes have a **Components** tab for cards, MDAs, XIOMs, and the SFM. For `nokia_sros`, each card can also set the vCPUs, RAM, and NICs of its VM. In **Defaults & Groups**, a section without a kind shows every kind-specific setting and the kinds it applies to.

## Other settings

The **Other** tab of the Node Editor holds the node settings no other tab covers: `hostname`, `privileged`, `link-apply-mode`, `cgroupns-mode`, `cgroup-parent`, `pid-mode`, `volumes`, `security-opts`, `tmpfs`, and `config.vars`, the variables of [startup-config templates](https://containerlab.dev/manual/config-mgmt/#templating). These fields also come from the containerlab schema, so node settings added upstream show up here once the app ships the newer schema.

Variable values are YAML: `65001` is a number, `[2, 4]` a list, and `"65001"` a string. Volumes, security options, tmpfs mounts, and variables add up across `defaults`, kinds, and groups, so the node writes only the entries it adds. **Privileged** set to **Disabled** is written as `privileged: false`, since most kinds run privileged by default.

## Set the boot order

The **Stages** tab of the Node Editor sets containerlab [stages](https://containerlab.dev/manual/nodes/#stages). Under each stage (**Create**, **Create Links**, **Configure**, **Healthy**, **Exit**):

- **Wait for** holds the stage back until another node has finished a stage, for example: create `leaf1` only after `spine1` is healthy.
- **Command** runs a command when the node enters or leaves the stage, in the container or on the host.

Entries from `defaults`, `kinds`, or `groups` are listed with their source and can't be edited here; containerlab adds them to the node's own. The tab flags a node name that doesn't exist and nodes that wait for each other in a loop, since containerlab won't deploy that.

To see the order on the canvas, open the **Links** menu and choose **Show Wait-for Dependencies**. Dashed arrows point from the node that goes first to the node that waits.

## Edit the YAML

**Toggle YAML Split View** opens the file in a panel next to the canvas, on its **YAML** tab. The editor completes and checks containerlab keys as you type, and changes on either side show up on the other.

![Canvas and YAML side by side](../images/app/split-view-dark.webp#only-dark){ .shot }
![Canvas and YAML side by side](../images/app/split-view-light.webp#only-light){ .shot }

YAML is also a quick way to change many nodes at once.

## Add networks

The **Palette** also has **Networks**: **Host**, **Mgmt Net**, **Macvlan**, **VXLAN**, **VXLAN Stitch**, **Dummy**, **Bridge**, and **OVS Bridge**. Drag one in and connect nodes to it like to any other node.

## Learn the format

The containerlab manual covers the file in depth: [topology syntax](https://containerlab.dev/manual/topo-def-file/), [node properties](https://containerlab.dev/manual/nodes/), [kinds](https://containerlab.dev/manual/kinds/), and [networking](https://containerlab.dev/manual/network/).

<div class="next" markdown>
[:lucide-arrow-right: Layout and style](appearance.md)
[:lucide-arrow-right: Run a lab](labs.md)
</div>
