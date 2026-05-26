import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExplorerIncomingMessage,
  ExplorerNode,
  ExplorerUiState,
} from "@srl-labs/clab-ui/explorer";

import { createStandaloneExplorerBridge } from "./standaloneExplorer";
import {
  setCreateTopologyDialogRequester,
  setRuntimeConfirmDialogRequester,
} from "./runtimeActionFlows";
import type { EndpointConfig } from "./stores/endpointStore";
import type { TopologyFileEntry } from "./standaloneHostShared";

type ExplorerSnapshotMessage = Extract<
  ExplorerIncomingMessage,
  { command: "snapshot" }
>;
type ExplorerUiStateMessage = Extract<
  ExplorerIncomingMessage,
  { command: "uiState" }
>;

const HELP_LINKS = [
  ["Containerlab Documentation", "https://containerlab.dev/"],
  [
    "VS Code Extension Documentation",
    "https://containerlab.dev/manual/vsc-extension/",
  ],
  ["Browse Labs on GitHub (srl-labs)", "https://github.com/srl-labs/"],
  ["Join our Discord server", "https://discord.gg/vAyddtaEV9"],
] as const;

const SANDBOX_ENDPOINT: EndpointConfig = {
  id: "endpoint-1",
  url: "local://containerlab-pages",
  label: "Local workspace",
  username: "local",
  sessionDuration: "24h",
  status: "connected",
  connected: true,
};

function topologyFile(path: string, labName: string): TopologyFileEntry {
  return {
    endpointId: SANDBOX_ENDPOINT.id,
    filename: path.split("/").at(-1) ?? path,
    path,
    hasAnnotations: false,
    labName,
    deploymentState: "undeployed",
    topologyRef: {
      topologyId: `${SANDBOX_ENDPOINT.id}::${path}`,
      labName,
      yamlPath: path,
      source: "standalone",
    },
  };
}

function createExplorerBridge(input: {
  defaultExpandExplorerTrees?: boolean;
  endpoints?: EndpointConfig[];
  topologyFiles?: TopologyFileEntry[];
} = {}) {
  return createStandaloneExplorerBridge({
    debounceMs: 0,
    defaultExpandExplorerTrees: input.defaultExpandExplorerTrees,
    getEndpoints: () => input.endpoints ?? [],
    getLabs: () => new Map(),
    invalidateTopologyFileListCache: () => {},
    openFileEditor: async () => {},
    runLifecycle: async () => {},
    listTopologyFiles: async () => input.topologyFiles ?? [],
    loadTopologyFile: async () => {},
    removeEndpoint: async () => {},
    resolveApiTopologyPath: async () => undefined,
    resolveDeploymentState: async () => undefined,
    resolveTopologyRef: async () => undefined,
  });
}

function createEmptyExplorerBridge() {
  return createExplorerBridge();
}

function waitForExplorerSnapshot(
  bridge: ReturnType<typeof createStandaloneExplorerBridge>,
): Promise<ExplorerSnapshotMessage> {
  return new Promise((resolve) => {
    const unsubscribe = bridge.explorer.subscribe((message) => {
      if (message.command === "snapshot") {
        unsubscribe();
        resolve(message);
      }
    });
    bridge.explorer.connect();
  });
}

function waitForInitialExplorerMessages(
  bridge: ReturnType<typeof createStandaloneExplorerBridge>,
): Promise<ExplorerIncomingMessage[]> {
  const messages: ExplorerIncomingMessage[] = [];
  return new Promise((resolve) => {
    const unsubscribe = bridge.explorer.subscribe((message) => {
      messages.push(message);
      if (message.command === "snapshot") {
        unsubscribe();
        resolve(messages);
      }
    });
    bridge.explorer.connect();
  });
}

function waitForNextExplorerSnapshot(
  bridge: ReturnType<typeof createStandaloneExplorerBridge>,
): Promise<ExplorerSnapshotMessage> {
  return new Promise((resolve) => {
    const unsubscribe = bridge.explorer.subscribe((message) => {
      if (message.command === "snapshot") {
        unsubscribe();
        resolve(message);
      }
    });
  });
}

function waitForExplorerSnapshotMatching(
  bridge: ReturnType<typeof createStandaloneExplorerBridge>,
  predicate: (snapshot: ExplorerSnapshotMessage) => boolean,
): Promise<ExplorerSnapshotMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for matching explorer snapshot."));
    }, 1_000);
    const unsubscribe = bridge.explorer.subscribe((message) => {
      if (message.command !== "snapshot" || !predicate(message)) {
        return;
      }
      clearTimeout(timeout);
      unsubscribe();
      resolve(message);
    });
  });
}

function latestUiState(
  messages: ExplorerIncomingMessage[],
): ExplorerUiState {
  const uiStateMessages = messages.filter(
    (message): message is ExplorerUiStateMessage =>
      message.command === "uiState",
  );
  const latest = uiStateMessages.at(-1);
  assert.ok(latest, "expected an explorer uiState message");
  return latest.state;
}

function latestSnapshot(
  messages: ExplorerIncomingMessage[],
): ExplorerSnapshotMessage {
  const snapshots = messages.filter(
    (message): message is ExplorerSnapshotMessage =>
      message.command === "snapshot",
  );
  const latest = snapshots.at(-1);
  assert.ok(latest, "expected an explorer snapshot message");
  return latest;
}

function findNode(
  nodes: ExplorerNode[],
  id: string,
): ExplorerNode | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const childMatch = findNode(node.children, id);
    if (childMatch) {
      return childMatch;
    }
  }
  return undefined;
}

function fileRootNode(snapshot: ExplorerSnapshotMessage): ExplorerNode {
  const fileSection = fileExplorerSection(snapshot);
  assert.ok(fileSection, "expected file explorer section");
  const root = fileSection.nodes.find(
    (node) => node.id === `file-root:${SANDBOX_ENDPOINT.id}`,
  );
  assert.ok(root, "expected file explorer root node");
  return root;
}

function fileExplorerHasNode(
  snapshot: ExplorerSnapshotMessage,
  id: string,
): boolean {
  const fileSection = fileExplorerSection(snapshot);
  const root = fileSection?.nodes.find(
    (node) => node.id === `file-root:${SANDBOX_ENDPOINT.id}`,
  );
  return Boolean(root && findNode(root.children, id));
}

function fileExplorerSection(
  snapshot: ExplorerSnapshotMessage,
): ExplorerSnapshotMessage["sections"][number] | undefined {
  return snapshot.sections.find((section) => {
    const sectionId = String(section.id);
    return sectionId === "fileExplorer" || sectionId === "localLabs";
  });
}

function expandedBySection(
  state: ExplorerUiState,
): Partial<Record<string, string[]>> | undefined {
  return state.expandedBySection as
    | Partial<Record<string, string[]>>
    | undefined;
}

function fileExplorerExpandedIds(state: ExplorerUiState): string[] | undefined {
  const expanded = expandedBySection(state);
  return expanded?.fileExplorer ?? expanded?.localLabs;
}

function withFileExplorerExpandedIds(
  state: ExplorerUiState,
  itemIds: string[],
): ExplorerUiState {
  const expanded = expandedBySection(state);
  return {
    ...state,
    expandedBySection: {
      ...expanded,
      fileExplorer: itemIds,
      localLabs: itemIds,
    } as ExplorerUiState["expandedBySection"],
  };
}

function sectionById(
  snapshot: ExplorerSnapshotMessage,
  id: ExplorerSnapshotMessage["sections"][number]["id"],
): ExplorerSnapshotMessage["sections"][number] {
  const section = snapshot.sections.find((candidate) => candidate.id === id);
  assert.ok(section, `expected ${id} section`);
  return section;
}

function actionByCommandId(
  actions: ExplorerNode["actions"],
  commandId: string,
): ExplorerNode["actions"][number] {
  const action = actions.find((candidate) => candidate.commandId === commandId);
  assert.ok(action, `expected ${commandId} action`);
  return action;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function jsonRequestPayload(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  if (typeof init?.body === "string") {
    return JSON.parse(init.body) as Record<string, unknown>;
  }
  if (input instanceof Request) {
    return (await input.clone().json()) as Record<string, unknown>;
  }
  return {};
}

function labNameFromTopologyPath(path: string): string {
  return (
    path
      .split("/")
      .at(-1)
      ?.replace(/\.clab\.ya?ml$/i, "") || "new-lab"
  );
}

function addFileEntry(
  entriesByPath: Record<string, unknown[]>,
  path: string,
): void {
  const normalized = path.replace(/^\/+/, "");
  const segments = normalized.split("/");
  const name = segments.at(-1) ?? normalized;
  const parentPath = segments.slice(0, -1).join("/");
  entriesByPath[parentPath] = [
    ...(entriesByPath[parentPath] ?? []),
    {
      endpointId: SANDBOX_ENDPOINT.id,
      kind: "file",
      labName: labNameFromTopologyPath(normalized),
      name,
      path: normalized,
      topologyRef: topologyFile(
        normalized,
        labNameFromTopologyPath(normalized),
      ).topologyRef,
    },
  ];
}

function removeFileEntry(
  entriesByPath: Record<string, unknown[]>,
  path: string,
): void {
  const normalized = path.replace(/^\/+/, "");
  const parentPath = normalized.split("/").slice(0, -1).join("/");
  entriesByPath[parentPath] = (entriesByPath[parentPath] ?? []).filter(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { path?: unknown }).path !== normalized &&
      (entry as { path?: unknown }).path !== `${normalized}.annotations.json`,
  );
}

function installSandboxFetch(
  t: { after: (fn: () => void) => void },
  entriesByPath: Record<string, unknown[]>,
  options: { topologyFiles?: TopologyFileEntry[] } = {},
): void {
  const originalFetch = globalThis.fetch;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { origin: "http://localhost" },
      open(): null {
        return null;
      },
    },
  });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (
      url.pathname.startsWith("/auth/endpoints/") &&
      url.pathname.endsWith("/metrics")
    ) {
      return jsonResponse({
        serverInfo: { version: "test", uptime: "1s", startTime: "now" },
        metrics: {},
      });
    }
    if (url.pathname === "/api/runtime/file-explorer/tree") {
      return jsonResponse(
        entriesByPath[url.searchParams.get("path") ?? ""] ?? [],
      );
    }
    if (url.pathname === "/api/runtime/topology-file/create") {
      const payload = await jsonRequestPayload(input, init);
      const path = String(payload.fileName ?? "new-lab.clab.yml");
      const labName = labNameFromTopologyPath(path);
      addFileEntry(entriesByPath, path);
      options.topologyFiles?.push(topologyFile(path, labName));
      return jsonResponse({
        success: true,
        topologyRef: topologyFile(path, labName).topologyRef,
      });
    }
    if (url.pathname === "/api/runtime/topology-file/delete") {
      const payload = await jsonRequestPayload(input, init);
      const topologyRef = payload.topologyRef as { yamlPath?: unknown };
      const path = String(topologyRef?.yamlPath ?? "");
      removeFileEntry(entriesByPath, path);
      if (options.topologyFiles) {
        const index = options.topologyFiles.findIndex(
          (file) => file.path === path,
        );
        if (index >= 0) {
          options.topologyFiles.splice(index, 1);
        }
      }
      return jsonResponse({ path, success: true });
    }
    return jsonResponse({ error: `unexpected request: ${url.pathname}` }, 404);
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
      return;
    }
    delete (globalThis as { window?: unknown }).window;
  });
}

test("pages sandbox default expansion opens endpoint and file explorer trees", async (t) => {
  installSandboxFetch(t, {
    "": [
      {
        endpointId: SANDBOX_ENDPOINT.id,
        name: "labs",
        path: "labs",
        kind: "directory",
        hasChildren: true,
      },
    ],
    labs: [
      {
        endpointId: SANDBOX_ENDPOINT.id,
        name: "configs",
        path: "labs/configs",
        kind: "directory",
        hasChildren: true,
      },
      {
        endpointId: SANDBOX_ENDPOINT.id,
        name: "demo.clab.yml",
        path: "labs/demo.clab.yml",
        kind: "file",
        labName: "demo",
        topologyRef: topologyFile("labs/demo.clab.yml", "demo").topologyRef,
      },
    ],
    "labs/configs": [
      {
        endpointId: SANDBOX_ENDPOINT.id,
        name: "startup.cfg",
        path: "labs/configs/startup.cfg",
        kind: "file",
      },
    ],
  });

  const bridge = createExplorerBridge({
    defaultExpandExplorerTrees: true,
    endpoints: [SANDBOX_ENDPOINT],
    topologyFiles: [topologyFile("labs/demo.clab.yml", "demo")],
  });
  const messages = await waitForInitialExplorerMessages(bridge);
  const state = latestUiState(messages);

  assert.deepEqual(state.expandedBySection?.runningLabs, [
    `endpoint:${SANDBOX_ENDPOINT.id}`,
    `endpoint-section:local:${SANDBOX_ENDPOINT.id}`,
  ]);
  assert.deepEqual(fileExplorerExpandedIds(state), [
    `file-root:${SANDBOX_ENDPOINT.id}`,
    `file:${SANDBOX_ENDPOINT.id}:labs`,
    `file:${SANDBOX_ENDPOINT.id}:labs/configs`,
  ]);

  const root = fileRootNode(latestSnapshot(messages));
  assert.ok(
    findNode(root.children, `file:${SANDBOX_ENDPOINT.id}:labs/configs`),
    "nested directory should be present in the initial snapshot",
  );
  assert.ok(
    findNode(
      root.children,
      `file:${SANDBOX_ENDPOINT.id}:labs/configs/startup.cfg`,
    ),
    "nested file should be present in the initial snapshot",
  );
});

test("standalone default expansion remains disabled unless requested", async (t) => {
  installSandboxFetch(t, {
    "": [
      {
        endpointId: SANDBOX_ENDPOINT.id,
        name: "labs",
        path: "labs",
        kind: "directory",
        hasChildren: true,
      },
    ],
  });

  const bridge = createExplorerBridge({
    endpoints: [SANDBOX_ENDPOINT],
    topologyFiles: [topologyFile("labs/demo.clab.yml", "demo")],
  });
  const messages = await waitForInitialExplorerMessages(bridge);
  const root = fileRootNode(latestSnapshot(messages));

  assert.equal(root.children.length, 0);
  assert.equal(latestUiState(messages).expandedBySection, undefined);
});

test("pages sandbox default expansion respects manual file collapse", async (t) => {
  installSandboxFetch(t, {
    "": [
      {
        endpointId: SANDBOX_ENDPOINT.id,
        name: "labs",
        path: "labs",
        kind: "directory",
        hasChildren: true,
      },
    ],
    labs: [
      {
        endpointId: SANDBOX_ENDPOINT.id,
        name: "demo.clab.yml",
        path: "labs/demo.clab.yml",
        kind: "file",
        labName: "demo",
        topologyRef: topologyFile("labs/demo.clab.yml", "demo").topologyRef,
      },
    ],
  });

  const bridge = createExplorerBridge({
    defaultExpandExplorerTrees: true,
    endpoints: [SANDBOX_ENDPOINT],
    topologyFiles: [topologyFile("labs/demo.clab.yml", "demo")],
  });
  const messages = await waitForInitialExplorerMessages(bridge);
  const expandedState = latestUiState(messages);

  const persistedSnapshot = waitForNextExplorerSnapshot(bridge);
  bridge.explorer.persistUiState(expandedState);
  await persistedSnapshot;

  const collapsedSnapshot = waitForNextExplorerSnapshot(bridge);
  bridge.explorer.persistUiState(
    withFileExplorerExpandedIds(expandedState, []),
  );

  assert.equal(fileRootNode(await collapsedSnapshot).children.length, 0);
});

test("file explorer cache invalidation shows newly created annotation files", async (t) => {
  const entriesByPath: Record<string, unknown[]> = {
    "": [
      {
        endpointId: SANDBOX_ENDPOINT.id,
        name: "labs",
        path: "labs",
        kind: "directory",
        hasChildren: true,
      },
    ],
    labs: [
      {
        endpointId: SANDBOX_ENDPOINT.id,
        name: "demo.clab.yml",
        path: "labs/demo.clab.yml",
        kind: "file",
        labName: "demo",
        topologyRef: topologyFile("labs/demo.clab.yml", "demo").topologyRef,
      },
    ],
  };
  installSandboxFetch(t, entriesByPath);

  const bridge = createExplorerBridge({
    defaultExpandExplorerTrees: true,
    endpoints: [SANDBOX_ENDPOINT],
    topologyFiles: [topologyFile("labs/demo.clab.yml", "demo")],
  });
  const messages = await waitForInitialExplorerMessages(bridge);
  let root = fileRootNode(latestSnapshot(messages));
  assert.equal(
    findNode(
      root.children,
      `file:${SANDBOX_ENDPOINT.id}:labs/demo.clab.yml.annotations.json`,
    ),
    undefined,
  );

  entriesByPath.labs = [
    ...entriesByPath.labs,
    {
      endpointId: SANDBOX_ENDPOINT.id,
      name: "demo.clab.yml.annotations.json",
      path: "labs/demo.clab.yml.annotations.json",
      kind: "file",
    },
  ];
  const refreshedSnapshot = waitForNextExplorerSnapshot(bridge);
  bridge.invalidateFileExplorerCache(SANDBOX_ENDPOINT.id);

  root = fileRootNode(await refreshedSnapshot);
  assert.ok(
    findNode(
      root.children,
      `file:${SANDBOX_ENDPOINT.id}:labs/demo.clab.yml.annotations.json`,
    ),
    "annotation file should be present after invalidating the file explorer cache",
  );
});

test("create topology action refreshes the expanded file explorer tree", async (t) => {
  const topologyFiles: TopologyFileEntry[] = [];
  const entriesByPath: Record<string, unknown[]> = {
    "": [
      {
        endpointId: SANDBOX_ENDPOINT.id,
        name: "labs",
        path: "labs",
        kind: "directory",
        hasChildren: true,
      },
    ],
    labs: [],
  };
  installSandboxFetch(t, entriesByPath, { topologyFiles });
  const disposeCreateDialog = setCreateTopologyDialogRequester(async () => ({
    endpointId: SANDBOX_ENDPOINT.id,
    fileName: "labs/new.clab.yml",
  }));
  t.after(disposeCreateDialog);

  const bridge = createExplorerBridge({
    defaultExpandExplorerTrees: true,
    endpoints: [SANDBOX_ENDPOINT],
    topologyFiles,
  });
  const messages = await waitForInitialExplorerMessages(bridge);
  const runningSection = sectionById(latestSnapshot(messages), "runningLabs");
  const endpointNode = findNode(
    runningSection.nodes,
    `endpoint:${SANDBOX_ENDPOINT.id}`,
  );
  assert.ok(endpointNode, "expected endpoint node");
  const createAction = actionByCommandId(
    endpointNode.actions,
    "containerlab.editor.topoViewerEditor",
  );

  const refreshedSnapshot = waitForExplorerSnapshotMatching(bridge, (snapshot) =>
    fileExplorerHasNode(
      snapshot,
      `file:${SANDBOX_ENDPOINT.id}:labs/new.clab.yml`,
    ),
  );
  await bridge.explorer.invokeAction(createAction.actionRef);

  const root = fileRootNode(await refreshedSnapshot);
  assert.ok(
    findNode(root.children, `file:${SANDBOX_ENDPOINT.id}:labs/new.clab.yml`),
    "created topology file should appear in the already expanded file explorer tree",
  );
});

test("delete topology action refreshes the expanded file explorer tree", async (t) => {
  const topologyFiles: TopologyFileEntry[] = [
    topologyFile("labs/demo.clab.yml", "demo"),
  ];
  const entriesByPath: Record<string, unknown[]> = {
    "": [
      {
        endpointId: SANDBOX_ENDPOINT.id,
        name: "labs",
        path: "labs",
        kind: "directory",
        hasChildren: true,
      },
    ],
    labs: [
      {
        endpointId: SANDBOX_ENDPOINT.id,
        name: "demo.clab.yml",
        path: "labs/demo.clab.yml",
        kind: "file",
        labName: "demo",
        topologyRef: topologyFile("labs/demo.clab.yml", "demo").topologyRef,
      },
    ],
  };
  installSandboxFetch(t, entriesByPath, { topologyFiles });
  const disposeConfirmDialog = setRuntimeConfirmDialogRequester(async () => true);
  t.after(disposeConfirmDialog);

  const bridge = createExplorerBridge({
    defaultExpandExplorerTrees: true,
    endpoints: [SANDBOX_ENDPOINT],
    topologyFiles,
  });
  const messages = await waitForInitialExplorerMessages(bridge);
  const runningSection = sectionById(latestSnapshot(messages), "runningLabs");
  const labNode = findNode(
    runningSection.nodes,
    `local-lab:${SANDBOX_ENDPOINT.id}:labs/demo.clab.yml`,
  );
  assert.ok(labNode, "expected local lab node");
  const deleteAction = actionByCommandId(
    labNode.actions,
    "containerlab.lab.delete",
  );

  const refreshedSnapshot = waitForExplorerSnapshotMatching(
    bridge,
    (snapshot) =>
      !fileExplorerHasNode(
        snapshot,
        `file:${SANDBOX_ENDPOINT.id}:labs/demo.clab.yml`,
      ),
  );
  await bridge.explorer.invokeAction(deleteAction.actionRef);

  const root = fileRootNode(await refreshedSnapshot);
  assert.equal(
    findNode(root.children, `file:${SANDBOX_ENDPOINT.id}:labs/demo.clab.yml`),
    undefined,
    "deleted topology file should disappear from the already expanded file explorer tree",
  );
});

test("standalone Help & Feedback items open their configured external links", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const openedLinks: Array<{
    features?: string;
    target?: string;
    url: string;
  }> = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      open(url: string, target?: string, features?: string): null {
        openedLinks.push({ features, target, url });
        return null;
      },
    },
  });

  t.after(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
      return;
    }
    delete (globalThis as { window?: unknown }).window;
  });

  const bridge = createEmptyExplorerBridge();
  const snapshot = await waitForExplorerSnapshot(bridge);
  const helpSection = snapshot.sections.find(
    (section) => section.id === "helpFeedback",
  );

  assert.ok(helpSection);

  for (const [label, url] of HELP_LINKS) {
    const helpNode: ExplorerNode | undefined = helpSection.nodes.find(
      (candidate: ExplorerNode) => candidate.label === label,
    );
    assert.ok(helpNode, `${label} should be present`);
    assert.ok(helpNode.primaryAction, `${label} should have a primary action`);
    assert.equal(helpNode.primaryAction.commandId, "containerlab.openLink");

    await bridge.explorer.invokeAction(helpNode.primaryAction.actionRef);
    assert.deepEqual(openedLinks.at(-1), {
      features: "noopener,noreferrer",
      target: "_blank",
      url,
    });
  }
});
