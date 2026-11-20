---
description: Turn on WebMCP in Chrome and create topologies in the browser sandbox with create_lab and createCLOSTopology.
---

# Create labs with WebMCP

Agents can create topology files in the [browser sandbox](https://containerlab.app/sandbox/) through the page's `create_lab` and `createCLOSTopology` tools, without clicking through the editor.
{ .lead }

WebMCP is a proposed web standard: the page registers tools on `document.modelContext`, and an agent that can see the tab calls them. See [Chrome's WebMCP overview](https://developer.chrome.com/docs/ai/webmcp).

## Turn WebMCP on in Chrome

For local use, enable the testing flag. You need a recent Chrome (149 or later).

1. Open `chrome://flags/#enable-webmcp-testing`.
2. Set **WebMCP Testing** to **Enabled**.
3. Relaunch Chrome.

Sites in Chrome's [WebMCP origin trial](https://developer.chrome.com/docs/web-platform/origin-trials) can expose tools without the flag. For your own Chrome profile, the flag is enough.

## Open the sandbox

Both tools are registered only in the browser sandbox (files in browser storage, no lab host). The full web app does not expose them.

1. Open [https://containerlab.app/sandbox/](https://containerlab.app/sandbox/), or run `pnpm pages:dev` and open `http://127.0.0.1:5174/`.
2. Check the small mark at the top right: green means `document.modelContext` is available; dimmed red means WebMCP is off in this browser.

Point an agent that can use WebMCP (or Chrome DevTools' WebMCP tooling) at that tab. It should see `create_lab` and `createCLOSTopology`.

## What `create_lab` accepts

| Field | Required | Meaning |
| --- | --- | --- |
| `topology` | Yes | A Containerlab document (`name`, `topology.nodes`, …), validated against the same schema as the YAML editor |
| `annotations` | No | Canvas annotations (node positions and the rest). Omit it to auto-layout when the lab opens |

The tool writes `name.clab.yml` into sandbox storage, writes `name.clab.yml.annotations.json` when `annotations` is set, and opens the lab on the canvas.

## What `createCLOSTopology` accepts

Same shape as **Generate Clos Topology** / `containerlab generate`: tiers and images, not a hand-written node list. Every node links to every node of the next tier.

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | Yes | Lab name and `.clab.yml` file name |
| `tiers` | Yes | Stages from bottom to top; each has `count` and optional `kind` / `type` |
| `images` | Yes | Container image per kind used in the tiers |
| `nodePrefix`, `groupPrefix`, `managementNetwork`, `ipv4Subnet`, `ipv6Subnet`, `licenses` | No | Same options as the Clos dialog |
| `annotations` | No | Canvas annotations. Omit to auto-layout when the lab opens |

## Sample: six-node fabric with `createCLOSTopology`

Ask the agent for a six-node Clos: two hosts, two leaves, two spines. Tiers are bottom to top; every node links to every node of the next tier:

```json
{
  "name": "clos6",
  "tiers": [
    { "count": 2, "kind": "linux" },
    { "count": 2, "kind": "nokia_srlinux", "type": "ixrd2" },
    { "count": 2, "kind": "nokia_srlinux", "type": "ixrd3" }
  ],
  "images": {
    "linux": "ghcr.io/srl-labs/network-multitool:latest",
    "nokia_srlinux": "ghcr.io/nokia/srlinux:latest"
  }
}
```

Nodes are named `node1-1`, `node1-2`, … per tier. Omit `annotations` for auto-layout.

## Sample: six-node fabric with `create_lab`

For exact node names and links (two spines, two leaves, one host per leaf), call `create_lab` instead:

```json
{
  "topology": {
    "name": "fabric6",
    "topology": {
      "defaults": {
        "kind": "nokia_srlinux",
        "image": "ghcr.io/nokia/srlinux:latest"
      },
      "nodes": {
        "spine1": { "type": "ixrd3" },
        "spine2": { "type": "ixrd3" },
        "leaf1": { "type": "ixrd2" },
        "leaf2": { "type": "ixrd2" },
        "host1": {
          "kind": "linux",
          "image": "ghcr.io/srl-labs/network-multitool:latest"
        },
        "host2": {
          "kind": "linux",
          "image": "ghcr.io/srl-labs/network-multitool:latest"
        }
      },
      "links": [
        { "endpoints": ["spine1:e1-1", "leaf1:e1-49"] },
        { "endpoints": ["spine1:e1-2", "leaf2:e1-49"] },
        { "endpoints": ["spine2:e1-1", "leaf1:e1-50"] },
        { "endpoints": ["spine2:e1-2", "leaf2:e1-50"] },
        { "endpoints": ["leaf1:e1-1", "host1:eth1"] },
        { "endpoints": ["leaf2:e1-1", "host2:eth1"] }
      ]
    }
  }
}
```

Omitting `annotations` leaves placement to the editor's auto-layout. To pin positions yourself, add an `annotations` object next to that `topology`:

```json
{
  "nodeAnnotations": [
    { "id": "spine1", "position": { "x": 200, "y": 40 } },
    { "id": "spine2", "position": { "x": 400, "y": 40 } },
    { "id": "leaf1", "position": { "x": 200, "y": 180 } },
    { "id": "leaf2", "position": { "x": 400, "y": 180 } },
    { "id": "host1", "position": { "x": 200, "y": 320 } },
    { "id": "host2", "position": { "x": 400, "y": 320 } }
  ]
}
```

The sandbox cannot deploy. Download the file and run it on a lab host, or keep editing on the canvas. For a larger leaf–spine example, see [Leaf–spine fabric](../examples/fabric.md).

<div class="next" markdown>
[:lucide-arrow-right: Build a topology](topologies.md)
[:lucide-arrow-right: Leaf–spine fabric](../examples/fabric.md)
</div>
