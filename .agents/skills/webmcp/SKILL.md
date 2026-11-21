---
name: webmcp
description: >-
  Create or replace Containerlab topologies in the browser sandbox with the
  page WebMCP tools create_lab and create_clos_topology. Use when the user
  asks to create, generate, design, change, or extend a lab, topology, fabric,
  leaf-spine, or Clos network in the sandbox, or mentions WebMCP, create_lab,
  or create_clos_topology. A call with an existing name replaces that file.
  When this conversation already has the sandbox page id, call the tool
  directly. Do not list pages, re-read schemas, delete localStorage, or search
  the repo.
---

# WebMCP sandbox tools

The browser sandbox registers two tools on `document.modelContext`: `create_lab` and `create_clos_topology`. They exist only while the app has no lab lifecycle (the sandbox). The full web app does not register them. A successful call writes `{name}.clab.yml` into sandbox storage and opens it on the canvas. The sandbox cannot deploy.

The live `inputSchema` from `list_webmcp_tools` lists the main fields; `create_lab` checks the full Containerlab schema when it runs. This skill is how to choose and call the tools. Field details and examples are in [reference.md](reference.md).

## Find the sandbox

If this conversation already has the sandbox page id, reuse it. Do not call `list_pages` or `list_webmcp_tools` again.

Otherwise:

1. List open browser pages and select the sandbox tab: [https://containerlab.app/sandbox/](https://containerlab.app/sandbox/) or the local pages app at `http://127.0.0.1:5174/`.
2. If it is not open, navigate a tab there, then list pages again and use that page id.
3. Call `list_webmcp_tools` on that page once. Expect `create_lab` and `create_clos_topology`. Remember the page id.

If those names are absent, WebMCP is off in this browser. Stop and tell the user to enable **WebMCP Testing** at `chrome://flags/#enable-webmcp-testing` and relaunch Chrome. The sandbox shows a green mark in the left rail, above Help & Feedback, only when `document.modelContext` is available. Do not recreate the topology by typing into the editor.

## Call a page tool

Discover the host schemas once, the first time you call a page tool in this conversation (`list_pages`, `list_webmcp_tools`, `execute_webmcp_tool`, `navigate_page`). Use the browser namespace that owns the sandbox tab. Later calls use the page id and schema you already have.

`execute_webmcp_tool` takes:

- `pageId` — number from the page list
- `toolName` — `create_lab` or `create_clos_topology`
- `input` — a JSON **string** of the tool arguments, not a nested object

Read the result before doing anything else.

- Success: `{ fileName, topologyRef, autoLayout, replaced }`. `autoLayout: true` means annotations were omitted and the editor places the nodes. `replaced: true` means a file of that name was overwritten.
- Failure: `{ error }` with schema or generator messages joined by `"; "`. Nothing was changed: a file of that name keeps its previous content. Fix the input from that text and call again. Do not switch tools to dodge a validation error that belongs to the topology. Do not search the repository.

## Pick the tool

| Design | Tool |
| --- | --- |
| Every node links to every node of the next tier, and generated names are fine | `create_clos_topology` |
| Named nodes, a partial mesh, rail-optimized wiring, or any link the generator would not draw | `create_lab` |

Tiers are bottom to top (hosts, then leaves, then spines). `create_clos_topology` always builds a full mesh between adjacent tiers. A rail-optimized fabric (each host port to one leaf) is `create_lab`.

## create_lab

Pass a wrapper. Do not pass a bare Containerlab document: a document has its own `name`, and the tool then ignores sibling `annotations`.

```json
{ "topology": { "name": "lab-name", "topology": { "nodes": {}, "links": [] } }, "annotations": {} }
```

`topology` is a Containerlab document: required `name` and `topology.nodes`. `name` matches `^[a-zA-Z0-9][a-zA-Z0-9-._]*$` and becomes the file name `{name}.clab.yml`. Kinds, node names, and links must satisfy the editor schema. Short links are `{ "endpoints": ["nodeA:eth1", "nodeB:swp1"] }`. Put images on `topology.kinds` or on each node.

Omit `annotations` to auto-layout. When you send them, node ids must match the node names in the document.

## create_clos_topology

Required: `name`, `tiers`, `images`.

- `name` matches `^[A-Za-z0-9_-]+$` (no dot). Same file rule: `{name}.clab.yml`.
- `tiers`: array, bottom to top. Each item is `{ "count": N, "kind": "linux", "type": "ixrd2" }`. `count` is an integer from 1 to 256. Omitted `kind` becomes `nokia_srlinux`. A fabric has at most 1024 nodes and 4096 links.
- `images`: one non-empty image string for every kind in the tiers, including `nokia_srlinux` when a tier has no `kind`.

Optional: `licenses`, `nodePrefix` (default `node`), `groupPrefix` (default `tier`), `managementNetwork`, `ipv4Subnet`, `ipv6Subnet`, `annotations`.

Nodes are named `{nodePrefix}{tier}-{index}` starting at 1, in groups `{groupPrefix}-{tier}`. On a lower tier, interface numbers continue after the links to the tier below. Kinds the generator does not know fail with `Kind '…' cannot be generated.` Use a kind from [reference.md](reference.md).

For SR Linux use `ghcr.io/nokia/srlinux:latest`. For Linux hosts use `ghcr.io/srl-labs/network-multitool:latest`. Other kinds often need a locally built image; still pass the image string, and say so when you report the result.

## Update an existing design

Call the same tool again with the same `name` and the complete topology. The tool replaces `{name}.clab.yml` and its annotations, then reopens the canvas. One call. Do not list pages, delete sandbox storage, or open a second lab.

Send the whole design, not a diff. Send `annotations` again when the canvas should keep a layout, and give every new node a position. A request such as "add two spines" keeps the current nodes and links, adds the new nodes and the links they need, and adds positions for the new nodes.

## After the call

Confirm `fileName` and whether the canvas opened. Tell the user the sandbox cannot deploy: download the file and run it on a lab host, or keep editing on the canvas. Do not add a second lab unless the user asked for one. To change the lab you just wrote, follow [Update an existing design](#update-an-existing-design).
