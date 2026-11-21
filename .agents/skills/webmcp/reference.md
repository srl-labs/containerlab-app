# WebMCP tool reference

Read this when you are filling `create_lab` or `create_clos_topology`. The live `inputSchema` from `list_webmcp_tools` lists the main fields. `create_lab` checks the full Containerlab schema when it runs, and its error messages name the field to fix.

## create_clos_topology

Tiers are bottom to top. Every node links to every node of the next tier.

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

A tier has at most 256 nodes, and a fabric at most 1024 nodes and 4096 links. `images` needs an entry for every kind in the tiers, including `nokia_srlinux` when a tier has no `kind`.

That writes `clos6.clab.yml` with nodes `node1-1`, `node1-2`, `node2-1`, … and groups `tier-1`, `tier-2`, `tier-3`. Set `nodePrefix` and `groupPrefix` to change those prefixes. Omit `annotations` for auto-layout.

Interface numbers on tier N start at 1 for the first tier, and at `1 + (count of the tier below)` after that, so a leaf's downlinks and uplinks do not reuse a port.

### Kinds the generator accepts

| Kind | Interface |
| --- | --- |
| `nokia_srlinux` | `e1-1`, `e1-2`, … |
| `nokia_sros`, `nokia_srsim` | `1/1/1`, `1/1/2`, … |
| `cisco_xrv9k` | `Gi0/0/0/1`, … |
| `juniper_vjunosswitch`, `juniper_vjunosevolved`, `juniper_vjunosrouter` | `et-0/0/1`, `et-0/0/2`, … |
| `juniper_vqfx`, `juniper_vmx`, `juniper_vsrx` | `ge-0/0/1`, `ge-0/0/2`, … |
| `arista_veos` | `Et1/1`, … |
| `nvidia_cumulusvx` | `swp1`, `swp2`, … |
| `linux`, `arista_ceos`, `cisco_xrd`, `cisco_iol`, `frr`, `sonic-vs`, `sonic-vm`, `juniper_crpd`, and the other `eth%d` kinds | `eth1`, `eth2`, … |

The generator substitutes `%d` with a 1-based index, so the first Junos port is `et-0/0/1` or `ge-0/0/1`. A kind missing from this table fails Clos generation. `create_lab` can still use any kind in the Containerlab schema; name the interfaces yourself.

`nvidia_cumulusvx` images are not published. `vrnetlab/nvidia_cumulus-vx:<version>` has to be built from a qcow2. The string is still valid in the file.

## create_lab

Wrapper form. `annotations` next to `topology`, not inside the document.

```json
{
  "topology": {
    "name": "fabric6",
    "topology": {
      "kinds": {
        "nokia_srlinux": { "image": "ghcr.io/nokia/srlinux:latest" },
        "linux": { "image": "ghcr.io/srl-labs/network-multitool:latest" }
      },
      "nodes": {
        "spine1": { "kind": "nokia_srlinux", "type": "ixrd3" },
        "spine2": { "kind": "nokia_srlinux", "type": "ixrd3" },
        "leaf1": { "kind": "nokia_srlinux", "type": "ixrd2" },
        "leaf2": { "kind": "nokia_srlinux", "type": "ixrd2" },
        "host1": { "kind": "linux" },
        "host2": { "kind": "linux" }
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

Node names match `^[a-zA-Z0-9][a-zA-Z0-9-._|]*$`. Each endpoint is `node:interface` with no spaces. Optional link fields include `mtu` (1–65535) and `ipv4` / `ipv6` as one prefix per endpoint.

Use this tool when the wiring is not a full mesh. A 4-rail DGX-style fabric is one example: each host `ethN` goes only to `railN`, and each rail uplinks to both spines. Clos generation cannot express that.

## Annotations

Omit the property to auto-layout. When present, the object is stored as `{name}.clab.yml.annotations.json` and the lab opens with those positions. `nodeAnnotations`, `freeTextAnnotations` and the other `…Annotations` keys are arrays; a malformed entry fails the call before anything is written.

```json
{
  "nodeAnnotations": [
    { "id": "spine1", "position": { "x": 200, "y": 40 }, "icon": "spine" },
    { "id": "leaf1", "position": { "x": 200, "y": 180 }, "icon": "leaf" },
    { "id": "host1", "position": { "x": 200, "y": 320 }, "icon": "server" }
  ]
}
```

`id` must be the node name (`node1-1` after Clos generation, not a role you wish it had). Icons the canvas already uses include `spine`, `leaf`, and `server`. Optional text uses `freeTextAnnotations` (`id`, `text`, `position`, `width`, `height`). See `docs/examples/fabric.clab.yml.annotations.json` for a small file and `docs/examples/midnight-fabric.clab.yml.annotations.json` for groups and headings.
