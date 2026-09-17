# `@containerlab/clab-ui` Integrator Guide

This guide is for teams embedding `@containerlab/clab-ui` into another product.

If you are trying to:

- render the topology editor/viewer in your own app
- host the UI inside a VS Code webview or another `window.postMessage` shell
- build a browser app backed by your own API

start here.

## What This Package Is

`@containerlab/clab-ui` is the shared topology UI package used by the current
containerlab consumers. It owns:

- the React UI
- the topology session client
- shared host contracts
- explorer/theme/feature-specific entrypoints

It does not own your product runtime. The embedding app still owns:

- authentication
- file access and persistence
- topology session creation and disposal
- lifecycle actions like deploy/destroy/redeploy
- product-specific message routing

## Supported Public Surface

Supported imports:

- `@containerlab/clab-ui`
- `@containerlab/clab-ui/host`
- `@containerlab/clab-ui/session`
- `@containerlab/clab-ui/theme`
- `@containerlab/clab-ui/explorer`
- `@containerlab/clab-ui/explorer/filter` (pure filtering utilities, also available through Node.js `require`)
- `@containerlab/clab-ui/inspect`
- `@containerlab/clab-ui/welcome`
- `@containerlab/clab-ui/node-impairments`
- `@containerlab/clab-ui/wireshark-vnc`
- `@containerlab/clab-ui/styles/global.css`

Do not import from `src/*`, `core/*`, or `services/*`. Those are internal repo
paths, not a supported consumer API.

## Install

Requirements:

- Node.js `>= 24`
- npm
- `react`
- `react-dom`

The public package is distributed on npmjs.org. No GitHub token or custom registry mapping is needed. Existing consumers of `@srl-labs/clab-ui` must update their dependency and imports to `@containerlab/clab-ui`; previously published GitHub Packages versions remain separate.

Install:

```bash
npm install @containerlab/clab-ui react react-dom
```

## 5-Minute Quickstart

This is the minimum useful browser integration.

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "@containerlab/clab-ui";
import { createApiClabUiHost, createClabUiRuntime } from "@containerlab/clab-ui/host";
import type { TopologyRef } from "@containerlab/clab-ui/session";
import { MuiThemeProvider, applyThemeVars } from "@containerlab/clab-ui/theme";
import "@containerlab/clab-ui/styles/global.css";

async function main(): Promise<void> {
  applyThemeVars(document.documentElement, "dark");

  const topologyRef: TopologyRef = {
    topologyId: "lab:/work/labs/demo.clab.yml",
    labName: "demo",
    yamlPath: "/work/labs/demo.clab.yml",
    source: "standalone"
  };

  const sessionResponse = await fetch("/api/topology/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      topologyRef,
      mode: "edit",
      deploymentState: "undeployed",
      runtimeContainers: []
    })
  });

  if (!sessionResponse.ok) {
    throw new Error(`Failed to create topology session: ${sessionResponse.status}`);
  }

  const { sessionId, topologyRef: canonicalTopologyRef } = (await sessionResponse.json()) as {
    sessionId: string;
    topologyRef?: TopologyRef;
  };

  const runtime = createClabUiRuntime({
    host: createApiClabUiHost({
      baseUrl: "/api",
      targetWindow: window,
      postMessage(message) {
        console.debug("clab-ui host command", message);
      }
    })
  });

  runtime.session.setContext({
    sessionId,
    topologyRef: canonicalTopologyRef ?? topologyRef,
    mode: "edit",
    deploymentState: "undeployed",
    runtimeContainers: []
  });

  const initialData = {
    dockerImages: [],
    customNodes: [],
    defaultNode: "",
    customIcons: []
  };

  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Root element not found");
  }

  createRoot(container).render(
    <MuiThemeProvider>
      <App initialData={initialData} runtime={runtime} />
    </MuiThemeProvider>
  );
}

void main();
```

That example does three critical things:

1. Creates a topology session before rendering the app
2. Sets `runtime.session` context before the first snapshot request
3. Provides parsed schema bootstrap data

If you skip step 2, the app mounts, but the first topology snapshot request has
no context to work with.

## Integration Model

`App` accepts optional React `slots` for a workspace `header`, replacement
`content` (such as a file editor), and an `emptyState` overlay. Supplying
`content` hides the topology canvas and its controls while preserving the
mounted canvas state. Set `lifecycleActionsAvailable={false}` when the host
cannot deploy or apply labs. These options are exported as `AppLayoutOptions`.
Hosts should use these props instead of inspecting or modifying the UI's DOM.

`TopologySessionCore` serializes operations by `documentKey` within one process
and rejects edits when the backing document differs from the last snapshot.
The default key is the YAML path; remote hosts should include the endpoint and
lab identity. Cached file adapters should implement `invalidateCache()` so the
comparison reads current data. This does not provide a distributed lock or an
atomic conditional write against external writers. Failed multi-file saves
restore backups where possible; they are not crash-atomic.

Every integration follows the same shape:

1. Create a host bridge
2. Create a runtime with `createClabUiRuntime(...)`
3. Set the topology session context
4. Render `<App initialData={...} runtime={runtime} />`
5. Handle product-owned commands outside the package

The main choice is which host bridge you use.

## Which Host Pattern To Use

### Pattern A: `createWindowClabUiHost`

Use this for:

- VS Code webviews
- browser shells already based on `window.postMessage`
- integrations where the embedding product already owns message routing

Typical usage:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App, subscribeToWebviewMessages } from "@containerlab/clab-ui";
import { createClabUiRuntime, createWindowClabUiHost } from "@containerlab/clab-ui/host";
import "@containerlab/clab-ui/styles/global.css";

const runtime = createClabUiRuntime({ host: createWindowClabUiHost() });
const initialData = (window as Record<string, unknown>).__INITIAL_DATA__ ?? {};

subscribeToWebviewMessages(
  (event) => {
    console.debug("host message", event.data);
  },
  undefined,
  runtime.host
);

const container = document.getElementById("root");
if (!container) throw new Error("Root element not found");

createRoot(container).render(
  <React.StrictMode>
    <App initialData={initialData} runtime={runtime} />
  </React.StrictMode>
);
```

Reference consumer:

- [vscode-containerlab/src/webviews/reactTopoViewer/entry.tsx](/home/flschwar/projects/clab/vscode-containerlab/src/webviews/reactTopoViewer/entry.tsx)

### Pattern B: `createApiClabUiHost`

Use this for:

- normal browser apps
- standalone web products
- products where topology persistence lives behind HTTP endpoints

Reference consumer:

- [containerlab-app/packages/standalone-runtime/src/standaloneApp.tsx](/home/flschwar/projects/clab/containerlab-app/packages/standalone-runtime/src/standaloneApp.tsx)

Important: `createApiClabUiHost` only handles the topology request/command
transport. Your app still has to create and destroy topology sessions.

### Pattern C: custom `ClabUiHost`

Use this only if the exported host helpers do not fit your transport model.

If you do this, implement the contracts from `@containerlab/clab-ui/host`
intentionally. Do not copy private code from this repository.

## Bootstrap Data Contract

`App` accepts `initialData` with this shape:

```ts
interface InitialGraphData {
  schemaData?: SchemaData;
  dockerImages?: string[];
  customNodes?: CustomNodeTemplate[];
  defaultNode?: string;
  customIcons?: CustomIconInfo[];
}
```

Field guidance:

| Field | Type | Required in practice | Meaning |
| --- | --- | --- | --- |
| `schemaData` | `SchemaData` | No | Optional override for the bundled containerlab schema metadata used by the editor and palette |
| `dockerImages` | `string[]` | No | Available images shown in UI affordances |
| `customNodes` | `CustomNodeTemplate[]` | No | Reusable node templates |
| `defaultNode` | `string` | No | Name of the default custom node template |
| `customIcons` | `CustomIconInfo[]` | No | Custom icon catalog available to the UI |

Recommended default:

```ts
const initialData = {
  dockerImages: [],
  customNodes: [],
  defaultNode: "",
  customIcons: []
};
```

### How To Produce `schemaData`

`clab-ui` bundles default containerlab schema metadata. Hosts only need to
provide `schemaData` when they want to override that bundled default, for
example with a newer or custom schema. Use the exported schema helper:

```ts
import { parseSchemaData } from "@containerlab/clab-ui/session";

const schemaData = parseSchemaData(rawSchemaJson as Record<string, unknown>);
```

`schemaData` is parsed from a containerlab schema JSON object. The package does
not fetch override schemas for you.

### `CustomNodeTemplate`

Minimum useful shape:

```ts
type CustomNodeTemplate = {
  name: string;
  kind: string;
  type?: string;
  image?: string;
  icon?: string;
  iconColor?: string;
  iconCornerRadius?: number;
  baseName?: string;
  interfacePattern?: string;
  setDefault?: boolean;
};
```

### `CustomIconInfo`

Shape:

```ts
type CustomIconInfo = {
  name: string;
  source: "workspace" | "global";
  dataUri: string;
  format: "svg" | "png";
};
```

## Topology Session Context Contract

The runtime session context is the core integration contract. The UI snapshot
flow reads from it immediately after mount.

Shape:

```ts
type TopologyUiContext = {
  topologyRef?: TopologyRef;
  path?: string;
  mode?: "edit" | "view";
  deploymentState?: "deployed" | "undeployed" | "unknown";
  sessionId?: string;
  runtimeContainers?: HostRuntimeContainer[];
};
```

### `TopologyRef`

Shape:

```ts
type TopologyRef = {
  topologyId: string;
  labName: string;
  yamlPath: string;
  annotationsPath?: string;
  source: "vscode" | "standalone";
};
```

Field guidance:

| Field | Meaning |
| --- | --- |
| `topologyId` | Stable identity for this topology in your host |
| `labName` | Lab name used by the backend/session layer |
| `yamlPath` | Canonical topology file path |
| `annotationsPath` | Optional explicit annotations file path |
| `source` | Which product family owns the topology session |

### Required before first render

If you expect the topology to load immediately, set at least:

- `sessionId`
- `topologyRef`
- `mode`
- `deploymentState`

before rendering `App`.

The UI calls `requestSnapshot()` on mount through its topology session client.

## Minimal API Contract For `createApiClabUiHost`

If you use `createApiClabUiHost`, the default transport contract is:

### `POST /api/topology/sessions`

Purpose:

- create a topology session before rendering the UI

Request body:

```json
{
  "topologyRef": {
    "topologyId": "lab:/work/labs/demo.clab.yml",
    "labName": "demo",
    "yamlPath": "/work/labs/demo.clab.yml",
    "source": "standalone"
  },
  "mode": "edit",
  "deploymentState": "undeployed",
  "runtimeContainers": []
}
```

Response body:

```json
{
  "sessionId": "string",
  "topologyRef": {
    "topologyId": "string",
    "labName": "string",
    "yamlPath": "string",
    "annotationsPath": "string",
    "source": "standalone"
  }
}
```

### `DELETE /api/topology/sessions/:sessionId`

Purpose:

- dispose a topology session when the host no longer needs it

Response body:

```json
{ "success": true }
```

### `POST /api/topology/snapshot`

Purpose:

- fetch the authoritative topology snapshot for the current session

Request body:

```json
{
  "sessionId": "string",
  "topologyRef": {
    "topologyId": "string",
    "labName": "string",
    "yamlPath": "string",
    "source": "standalone"
  },
  "mode": "edit",
  "deploymentState": "undeployed",
  "runtimeContainers": [],
  "externalChange": false
}
```

Response body:

- a `TopologySnapshot`

### `POST /api/topology/command`

Purpose:

- apply a topology command against the authoritative host state

Request body:

```json
{
  "sessionId": "string",
  "topologyRef": {
    "topologyId": "string",
    "labName": "string",
    "yamlPath": "string",
    "source": "standalone"
  },
  "mode": "edit",
  "deploymentState": "undeployed",
  "runtimeContainers": [],
  "baseRevision": 12,
  "command": {
    "command": "undo"
  }
}
```

Response body:

- a `TopologyHostResponseMessage`

### Authentication

The reference standalone implementation sends browser credentials on its fetches.
Your app can use cookies, bearer tokens, or another auth layer, but the host is
responsible for it. `clab-ui` does not manage authentication.

### What `createApiClabUiHost` does not do

It does not:

- create sessions for you
- dispose sessions for you
- decide which topology to open
- implement lifecycle commands such as deploy/destroy/redeploy

Those remain your product responsibilities.

## Snapshot Contract

The UI expects `TopologySnapshot` objects with this shape:

```ts
type TopologySnapshot = {
  revision: number;
  documentRevision?: string;
  nodes: TopoNode[];
  edges: TopoEdge[];
  annotations: TopologyAnnotations;
  yamlFileName: string;
  annotationsFileName: string;
  yamlContent: string;
  annotationsContent: string;
  labName: string;
  mode: "edit" | "view";
  deploymentState: "deployed" | "undeployed" | "unknown";
  labSettings?: LabSettings;
  canUndo: boolean;
  canRedo: boolean;
};
```

Minimum practical requirements:

- `revision`
- `nodes`
- `edges`
- `annotations`
- `yamlContent`
- `annotationsContent`
- `labName`
- `mode`
- `deploymentState`
- `canUndo`
- `canRedo`

## Command Contract

Your host must support the public `TopologyHostCommand` union. The command names
currently include:

- `addNode`
- `editNode`
- `deleteNode`
- `addLink`
- `editLink`
- `deleteLink`
- `setYamlContent`
- `setAnnotationsContent`
- `savePositions`
- `savePositionsAndAnnotations`
- `setAnnotations`
- `setEdgeAnnotations`
- `setViewerSettings`
- `setNodeGroupMembership`
- `setNodeGroupMemberships`
- `setAnnotationsWithMemberships`
- `batch`
- `setLabSettings`
- `undo`
- `redo`

If your host cannot support a command, that is an integration gap, not
something the UI can recover from automatically.

## Host Responsibilities Outside Topology Transport

The topology API is only part of the embedding contract. Your host still needs
to own:

- deploy/destroy/redeploy lifecycle actions
- SSH/shell/log actions for nodes
- packet capture actions
- custom node persistence
- icon list/upload/delete flows
- SVG export handling

If you implement a custom host directly, these are the relevant `/host`
contracts:

- `ClabUiHost`
- `ClabUiExplorerHost`
- `ClabUiTopoViewerHost`

Important lifecycle action names:

- `deployLab`
- `deployLabCleanup`
- `destroyLab`
- `destroyLabCleanup`
- `redeployLab`
- `redeployLabCleanup`

Important node action names:

- `ssh`
- `shell`
- `logs`

Important topo viewer events:

- `modeChanged`
- `panelAction`
- `customNodesUpdated`
- `customNodeError`
- `iconList`
- `lifecycleLog`
- `lifecycleStatus`
- `fitViewport`
- `svgExportResult`

## Explorer Integration

If your product embeds the explorer UI, use:

- `ContainerlabExplorerView`
- `buildExplorerSnapshot`
- explorer message/state types from `@containerlab/clab-ui/explorer`

If you already have a product-specific explorer backend, prefer wiring it
through the exported explorer controller/helpers rather than duplicating logic.

## Theme Integration

Recommended package usage:

- import `@containerlab/clab-ui/styles/global.css` once
- wrap with `MuiThemeProvider`
- apply CSS variables with `applyThemeVars(...)` if your host controls theme mode

## Local Workspace and External Consumer Checks

From the `containerlab-app` repository root:

```bash
corepack pnpm install --frozen-lockfile
pnpm ui
pnpm test:package
```

Monorepo hosts resolve `@containerlab/clab-ui` through `workspace:*` and consume its public `dist/` exports. Rebuild after UI changes. For a separate consumer, use `pnpm ui:pack`, then install that tarball with npm in the consumer project. No sibling checkout or `CLAB_UI_SOURCE` override is required.

## Stability Rules

For read-only documentation embeds, use the standalone viewer and `<clab-topology>` component described in the [component reference](../../docs/viewer/reference.md). The static assets ship under `@containerlab/clab-ui/viewer/static/*`; an iframe per topology isolates its stores from the host application and other diagrams.

Add the boolean `borderless` attribute to show only the canvas on a transparent background, with no grid or surrounding controls. In Zensical Markdown, use `borderless="true"` on the `clab` fence. Both presentations support mouse-wheel and pinch zoom.

You can rely on:

- the package name
- the public subpaths listed in this document
- the `dist/` output
- the public `/host` and `/session` contracts

You should not rely on:

- repository-internal folder structure
- deep imports into non-exported paths
- source-only helpers that are not re-exported publicly

If you need a new integration hook, add it to the package API intentionally.
Do not reach into internals from the consumer.
