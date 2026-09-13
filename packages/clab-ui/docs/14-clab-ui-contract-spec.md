# 14. clab-ui Contract Spec

This page is the contract-level reference for integrating `@srl-labs/clab-ui` into a host product.

## Public export surface

| Export key | Purpose |
|---|---|
| `@srl-labs/clab-ui` | main `App`, message subscription helper, and store helpers |
| `@srl-labs/clab-ui/host` | host contracts, runtime factories, runtime context hooks, controller helpers |
| `@srl-labs/clab-ui/session` | `TopologyRef`, session client, message constants, schema helpers, runtime helpers |
| `@srl-labs/clab-ui/theme` | `MuiThemeProvider`, theme variable helpers |
| `@srl-labs/clab-ui/explorer` | explorer view and explorer snapshot helpers |
| `@srl-labs/clab-ui/inspect` | inspect bootstrapper |
| `@srl-labs/clab-ui/welcome` | welcome bootstrapper |
| `@srl-labs/clab-ui/node-impairments` | node-impairments bootstrapper |
| `@srl-labs/clab-ui/wireshark-vnc` | Wireshark/VNC bootstrapper |
| `@srl-labs/clab-ui/styles/global.css` | shared stylesheet |

!!! warning "Compatibility rule"
    Consumers should import only public subpaths from the export map. Repo-internal paths are not compatibility promises.

## `TopologyUiContext`

The host-side session context can include:

| Field | Meaning |
|---|---|
| `topologyRef` | canonical topology identity |
| `path` | explicit topology path override |
| `mode` | `edit` or `view` |
| `deploymentState` | `deployed`, `undeployed`, or `unknown` |
| `sessionId` | host-owned topology session identifier |
| `runtimeContainers` | runtime overlay data for the current lab |

`path` falls back to `topologyRef.yamlPath` when no explicit path is supplied.

## `ClabUiHost` shape

A `ClabUiHost` groups three surfaces:

| Surface | Purpose |
|---|---|
| `postMessage(...)` and `subscribe(...)` | generic host message transport |
| `explorer` | explorer-specific commands and subscriptions |
| `topoViewer` | topology-viewer semantic commands and subscriptions |
| `topology` | snapshot and command transport for authoritative topology state |
| optional `meta` flags | host hints such as `isDevMock` |

## Explorer host contract

| Method | Purpose |
|---|---|
| `connect()` | initialize the explorer bridge |
| `setFilter(filterText)` | update filter state |
| `invokeAction(actionRef)` | run one explorer action |
| `persistUiState(state)` | save explorer UI state |
| `subscribe(handler)` | receive explorer messages |

## Topology-viewer host contract

| Method family | Methods |
|---|---|
| lifecycle | `runLifecycle`, `cancelLifecycle` |
| layout and diagnostics | `toggleSplitView`, `dumpCssVars` |
| node actions | `runNodeAction` with `ssh`, `shell`, or `logs` |
| interface actions | `captureInterface`, `setLinkImpairment` |
| custom nodes | `saveCustomNode`, `deleteCustomNode`, `setDefaultCustomNode` |
| icons | `requestIconList`, `uploadIcon`, `deleteIcon`, `reconcileIcons` |
| export | `exportGrafanaBundle` |
| events | `subscribe` |

## Topology protocol

### Request types

- `topology-host:get-snapshot`
- `topology-host:command`

### Response types

- `topology-host:snapshot`
- `topology-host:ack`
- `topology-host:reject`
- `topology-host:error`

### Command verb families

| Family | Verbs |
|---|---|
| node and link edits | `addNode`, `editNode`, `deleteNode`, `addLink`, `editLink`, `deleteLink` |
| raw document replacement | `setYamlContent`, `setAnnotationsContent` |
| positions and annotations | `savePositions`, `savePositionsAndAnnotations`, `setAnnotations`, `setEdgeAnnotations` |
| viewer and grouping state | `setViewerSettings`, `setNodeGroupMembership`, `setNodeGroupMemberships`, `setAnnotationsWithMemberships` |
| lab settings and history | `setLabSettings`, `batch`, `undo`, `redo` |

## Snapshot and session semantics

A topology snapshot includes more than nodes and edges. The important fields are:

- `revision` and optional `documentRevision`
- `nodes`, `edges`, and `annotations`
- raw YAML and annotations content plus their source filenames
- `labName`, `mode`, and `deploymentState`
- optional `labSettings`
- `canUndo` and `canRedo`

The default topology session client created by `createTopologySessionClient(...)` or `createClabUiRuntime(...)`:

- stores context locally
- starts revision at `1` unless configured otherwise
- sends commands with the current revision
- does not create or destroy host-owned topology sessions by itself

## Host factory behavior

### `createWindowClabUiHost(...)`

Behavior:

- uses `window.postMessage` transport, or the VS Code API when available
- sends semantic explorer and topology-viewer commands such as `deployLab` or `clab-interface-capture`
- correlates topology requests with `requestId`
- keeps a pending-request map for snapshot and command calls
- times out a request after 30 seconds by default

### `createApiClabUiHost(...)`

Behavior:

- reuses `createWindowClabUiHost(...)` for explorer and topology-viewer semantic commands
- only overrides the `topology` surface to use HTTP POSTs
- posts snapshots to `/api/topology/snapshot`
- posts commands to `/api/topology/command`
- appends `sessionId` to the query string when present
- includes `sessionId`, `topologyRef`, `path`, `mode`, `deploymentState`, and `runtimeContainers` in the JSON payload

Important limitation:

- this helper does not create or dispose topology sessions for you

### `createClabUiRuntime(...)`

Behavior:

- composes a `host` with a topology session client
- uses `createTopologySessionClient(...)` by default unless a custom session client is supplied
- accepts `initialContext` for the initial session state

## Command and event names you will see in practice

### Extension-side semantic commands

- lifecycle: `deployLab`, `destroyLab`, `redeployLab`, and the `*Cleanup` variants
- lifecycle cancellation: `cancelLabLifecycle`
- split view: `topo-toggle-split-view`
- node actions: `clab-node-connect-ssh`, `clab-node-attach-shell`, `clab-node-view-logs`
- interface actions: `clab-interface-capture`, `clab-link-impairment`
- custom nodes: `save-custom-node`, `delete-custom-node`, `set-default-custom-node`
- icons: `icon-list`, `icon-upload`, `icon-delete`, `icon-reconcile`
- export: `export-svg-grafana-bundle`

### Webview push events

- topology and mode: `topology-data`, `topo-mode-changed`, `external-file-change`, `fit-viewport`
- panel and lifecycle: `panel-action`, `lab-lifecycle-status`, `lab-lifecycle-log`
- custom node and icon updates: `custom-nodes-updated`, `custom-node-error`, `icon-list-response`
- export result: `svg-export-result`

## Common integration failures

| Failure | Typical signal | Root cause |
|---|---|---|
| snapshot timeout | request rejects after 30 seconds | host never returned a matching response |
| unexpected response type | snapshot receives command response, or vice versa | message bridge mismatch |
| stale revision rejection | topology-host reject with newer snapshot | host and UI revision drifted |
| missing host methods | action silently no-ops or throws | host contract only partially implemented |
| browser HTTP host works for topology but not semantic commands | topology snapshots succeed but lifecycle or capture actions do nothing | `createApiClabUiHost(...)` only switches the topology transport, not the semantic command handling |

## Source anchors

- `clab-ui/package.json`
- `clab-ui/src/host/contracts.ts`
- `clab-ui/src/host/index.ts`
- `clab-ui/src/host/runtimeContext.tsx`
- `clab-ui/src/session/index.ts`
- `clab-ui/src/session/client.ts`
- `clab-ui/src/core/messages/extension.ts`
- `clab-ui/src/core/messages/webview.ts`
- `clab-ui/src/core/types/messages.ts`
