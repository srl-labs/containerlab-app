import type { ClabUiHost, ClabUiTopoViewerEvent } from "../../src/host/contracts";
import { defaultSchemaData } from "../../src/core/schema";
import type { ExplorerIncomingMessage, ExplorerUiState } from "../../src/explorer/shared/explorer/types";
import type { CustomIconInfo } from "../../src/core/types/icons";
import type { TopologyAnnotations } from "../../src/core/types/topology";
import {
  TopologySessionCore,
  buildRuntimeEdgeStatsUpdates,
  buildRuntimeNodeUpdates,
  createRuntimeContainerDataProvider,
  type FileSystemAdapter,
  type TopologyHostCommand,
  type TopologyHostResponseMessage,
  type TopologySnapshot
} from "../../src/session";
import type { HostRuntimeContainer } from "../../src/host";

import { fixtureFiles, TOPOLOGY_ROOT } from "./fixtureFiles";
import {
  buildHarnessExplorerSnapshot,
  HARNESS_EXPLORER_UI_STATE,
  parseHarnessExplorerAction,
  type HarnessHostLayout
} from "./harnessExplorer";

type SnapshotFixtureName = "basic" | "empty";

function normalizePath(filePath: string): string {
  if (filePath.startsWith(`${TOPOLOGY_ROOT}/`)) return filePath;
  const basename = filePath.split("/").filter(Boolean).at(-1) ?? filePath;
  return `${TOPOLOGY_ROOT}/${basename}`;
}

function annotationsPathFor(yamlPath: string): string {
  return `${yamlPath}.annotations.json`;
}

function dirname(filePath: string): string {
  const index = filePath.lastIndexOf("/");
  return index <= 0 ? "/" : filePath.slice(0, index);
}

function basename(filePath: string): string {
  return filePath.split("/").filter(Boolean).at(-1) ?? filePath;
}

function cloneFiles(): Map<string, string> {
  return new Map(Object.entries(fixtureFiles));
}

function recordHarnessMessage(message: unknown): void {
  const harnessWindow = window as unknown as {
    __CLAB_UI_HARNESS_MESSAGES__?: unknown[];
  };
  harnessWindow.__CLAB_UI_HARNESS_MESSAGES__ ??= [];
  harnessWindow.__CLAB_UI_HARNESS_MESSAGES__.push(message);
}

function toFixtureName(value: string | null): SnapshotFixtureName {
  return value === "empty" ? "empty" : "basic";
}

function toYamlPath(value: string | null): string {
  // ?fixture=<name> opens test/fixtures/topologies/<name>.clab.yml when it exists.
  const named = `${TOPOLOGY_ROOT}/${value ?? ""}.clab.yml`;
  if (value !== null && value !== "empty" && named in fixtureFiles) return named;
  const fixture = toFixtureName(value);
  return fixture === "empty" ? `${TOPOLOGY_ROOT}/empty.clab.yml` : `${TOPOLOGY_ROOT}/simple.clab.yml`;
}

class MemoryFsAdapter implements FileSystemAdapter {
  constructor(private readonly files: Map<string, string>) {}

  async readFile(filePath: string): Promise<string> {
    const path = normalizePath(filePath);
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file ${path}`);
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(normalizePath(filePath), content);
  }

  async unlink(filePath: string): Promise<void> {
    this.files.delete(normalizePath(filePath));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const normalizedOldPath = normalizePath(oldPath);
    const content = this.files.get(normalizedOldPath);
    if (content === undefined) {
      throw new Error(`ENOENT: no such file ${normalizedOldPath}`);
    }
    this.files.set(normalizePath(newPath), content);
    this.files.delete(normalizedOldPath);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(normalizePath(filePath));
  }

  dirname(filePath: string): string {
    return dirname(normalizePath(filePath));
  }

  basename(filePath: string): string {
    return basename(filePath);
  }

  join(...segments: string[]): string {
    const joined = segments.join("/").replace(/\/+/g, "/");
    return joined.startsWith("/") ? joined : `/${joined}`;
  }
}

export interface FakeClabUiHost extends ClabUiHost {
  getSnapshot(): Promise<TopologySnapshot>;
  harness: {
    getCurrentFile(): string;
    getFiles(): Map<string, string>;
    listTopologyFiles(): Array<{ filename: string; hasAnnotations: boolean }>;
    loadTopologyFile(filePath: string): Promise<TopologySnapshot>;
    readAnnotationsFile(filename: string): Promise<TopologyAnnotations>;
    readYamlFile(filename: string): Promise<string>;
    resetFiles(): Promise<void>;
    emitCurrentSnapshot(): Promise<void>;
    writeAnnotationsFile(filename: string, content: unknown): Promise<void>;
    writeYamlFile(filename: string, content: string): Promise<void>;
    setCustomIcons(icons: CustomIconInfo[]): void;
    emitHostMessage(message: unknown): void;
    applyRuntimeContainers(containers: HostRuntimeContainer[]): Promise<void>;
  };
}

export function createFakeClabUiHost(
  initialFixture: string | null,
  explorerLayout: HarnessHostLayout
): FakeClabUiHost {
  let files = cloneFiles();
  let fs = new MemoryFsAdapter(files);
  let currentYamlPath = toYamlPath(initialFixture);
  let core = createCore(currentYamlPath, fs);
  const messageSubscribers = new Set<(event: MessageEvent<unknown>) => void>();
  const topoViewerSubscribers = new Set<(event: ClabUiTopoViewerEvent) => void>();
  const explorerSubscribers = new Set<(message: ExplorerIncomingMessage) => void>();
  let explorerFilter = "";
  let explorerUiState: ExplorerUiState = HARNESS_EXPLORER_UI_STATE;

  function emitExplorerMessage(message: ExplorerIncomingMessage): void {
    for (const subscriber of Array.from(explorerSubscribers)) {
      subscriber(message);
    }
  }

  function emitExplorerSnapshot(): void {
    emitExplorerMessage(buildHarnessExplorerSnapshot(explorerLayout, Array.from(files.keys()), explorerFilter));
  }

  function createCore(yamlFilePath: string, adapter: FileSystemAdapter): TopologySessionCore {
    return new TopologySessionCore({
      fs: adapter,
      yamlFilePath,
      mode: "edit",
      deploymentState: "undeployed",
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: console.error
      }
    });
  }

  async function loadTopologyFile(filePath: string): Promise<TopologySnapshot> {
    const nextYamlPath = normalizePath(filePath);
    currentYamlPath = nextYamlPath;
    core.dispose();
    core = createCore(nextYamlPath, fs);
    const snapshot = await core.getSnapshot();
    emitSnapshot(snapshot);
    return snapshot;
  }

  async function resetFiles(): Promise<void> {
    files = cloneFiles();
    fs = new MemoryFsAdapter(files);
    await loadTopologyFile(currentYamlPath);
    emitExplorerSnapshot();
  }

  function readFileByName(filename: string): string | undefined {
    return files.get(normalizePath(filename));
  }

  function emitSnapshot(snapshot: TopologySnapshot): void {
    const event = { data: { type: "topology-host:snapshot", snapshot } } as MessageEvent<unknown>;
    for (const subscriber of Array.from(messageSubscribers)) {
      subscriber(event);
    }
  }

  return {
    async getSnapshot() {
      return core.getSnapshot();
    },

    harness: {
      // Same steps as the VS Code host on a lab refresh: rebuild the snapshot
      // with runtime data, then push edge and node updates.
      async applyRuntimeContainers(containers) {
        core.updateContext({
          deploymentState: "deployed",
          containerDataProvider: createRuntimeContainerDataProvider(containers)
        });
        const snapshot = await core.getSnapshot();
        emitSnapshot(snapshot);
        const edgeUpdates = buildRuntimeEdgeStatsUpdates(snapshot.edges, containers, {
          currentLabName: snapshot.labName,
          topology: undefined
        });
        const nodeUpdates = buildRuntimeNodeUpdates(containers, snapshot.labName);
        this.emitHostMessage({ type: "edge-stats-update", data: { edgeUpdates } });
        this.emitHostMessage({ type: "node-data-updated", data: { nodeUpdates } });
      },

      emitHostMessage(message) {
        const event = { data: message } as MessageEvent<unknown>;
        for (const subscriber of Array.from(messageSubscribers)) {
          subscriber(event);
        }
      },

      setCustomIcons(icons) {
        for (const subscriber of topoViewerSubscribers) {
          subscriber({ type: "iconList", icons });
        }
      },

      getCurrentFile() {
        return currentYamlPath;
      },

      getFiles() {
        return files;
      },

      listTopologyFiles() {
        return Array.from(files.keys())
          .filter((path) => path.endsWith(".clab.yml"))
          .map((path) => ({
            filename: basename(path),
            hasAnnotations: files.has(annotationsPathFor(path))
          }))
          .sort((left, right) => left.filename.localeCompare(right.filename));
      },

      loadTopologyFile,

      async readAnnotationsFile(filename: string) {
        const content = readFileByName(annotationsPathFor(normalizePath(filename)));
        if (content === undefined) {
          return {
            nodeAnnotations: [],
            freeTextAnnotations: [],
            freeShapeAnnotations: [],
            groupStyleAnnotations: [],
            edgeAnnotations: [],
            viewerSettings: {}
          };
        }
        return JSON.parse(content);
      },

      async readYamlFile(filename: string) {
        const content = readFileByName(filename);
        if (content === undefined) {
          throw new Error(`Missing YAML fixture ${filename}`);
        }
        return content;
      },

      resetFiles,

      async emitCurrentSnapshot() {
        emitSnapshot(await core.getSnapshot());
      },

      async writeAnnotationsFile(filename: string, content: unknown) {
        const yamlPath = normalizePath(filename);
        files.set(annotationsPathFor(yamlPath), JSON.stringify(content, null, 2));
        if (yamlPath === currentYamlPath) {
          await loadTopologyFile(currentYamlPath);
        }
      },

      async writeYamlFile(filename: string, content: string) {
        const yamlPath = normalizePath(filename);
        files.set(yamlPath, content);
        if (yamlPath === currentYamlPath) {
          await loadTopologyFile(currentYamlPath);
        }
        emitExplorerSnapshot();
      }
    },

    postMessage(message: unknown): void {
      recordHarnessMessage(message);
    },

    subscribe(handler: (event: MessageEvent<unknown>) => void): () => void {
      messageSubscribers.add(handler);
      return () => {
        messageSubscribers.delete(handler);
      };
    },

    meta: {
      isDevMock: true,
      disableDevMockTraffic: true
    },

    editorData: {
      getSchema: () => defaultSchemaData,
      getDockerImages: () => [],
      subscribeDockerImages: () => () => {}
    },

    explorer: {
      connect() {
        emitExplorerMessage({ command: "uiState", state: explorerUiState });
        emitExplorerSnapshot();
      },
      setFilter(filterText) {
        explorerFilter = filterText.trim();
        emitExplorerSnapshot();
      },
      async invokeAction(actionRef) {
        const action = parseHarnessExplorerAction(actionRef);
        if (action?.kind === "openLink") {
          window.open(action.url, "_blank", "noopener,noreferrer");
          return;
        }
        if (action?.kind !== "openFile") return;
        await loadTopologyFile(action.path);
        for (const subscriber of Array.from(topoViewerSubscribers)) {
          subscriber({ type: "fitViewport" });
        }
      },
      persistUiState(state) {
        explorerUiState = state;
      },
      subscribe(handler) {
        explorerSubscribers.add(handler);
        return () => {
          explorerSubscribers.delete(handler);
        };
      }
    },

    topoViewer: {
      runLifecycle() {},
      cancelLifecycle() {},
      toggleSplitView() {},
      runNodeAction() {},
      captureInterface(nodeName, interfaceName, options = {}) {
        recordHarnessMessage({
          command: "clab-interface-capture",
          nodeName,
          interfaceName,
          ...(options.label !== undefined ? { captureLabel: options.label } : {})
        });
      },
      captureTargets(targets, options = {}) {
        recordHarnessMessage({
          command: "clab-interface-capture",
          nodeName: targets[0]?.nodeName,
          interfaceName: targets[0]?.interfaceName,
          targets,
          ...(options.label !== undefined ? { captureLabel: options.label } : {})
        });
      },
      captureInterfaces(nodeName, interfaceNames, options = {}) {
        recordHarnessMessage({
          command: "clab-interface-capture",
          nodeName,
          interfaceName: interfaceNames[0],
          interfaceNames,
          ...(options.nodeNamespace === true ? { nodeNamespace: true } : {}),
          ...(options.label !== undefined ? { captureLabel: options.label } : {})
        });
      },
      setLinkImpairment() {},
      saveCustomNode() {},
      deleteCustomNode() {},
      setDefaultCustomNode() {},
      importCustomNodes() {},
      requestIconList() {},
      uploadIcon() {},
      deleteIcon() {},
      reconcileIcons() {},
      exportGrafanaBundle(payload) {
        recordHarnessMessage({ command: "export-svg-grafana-bundle", ...payload });
        window.setTimeout(() => {
          const event: ClabUiTopoViewerEvent = {
            type: "svgExportResult",
            requestId: payload.requestId,
            success: true,
            files: [`${payload.baseName}.svg`, `${payload.baseName}.dashboard.json`]
          };
          for (const subscriber of Array.from(topoViewerSubscribers)) {
            subscriber(event);
          }
        }, 0);
      },
      dumpCssVars() {},
      subscribe(handler) {
        topoViewerSubscribers.add(handler);
        return () => {
          topoViewerSubscribers.delete(handler);
        };
      }
    },

    topology: {
      async requestSnapshot() {
        return core.getSnapshot();
      },

      async dispatchCommand(_context, baseRevision, command): Promise<TopologyHostResponseMessage> {
        return core.applyCommand(command as TopologyHostCommand, baseRevision);
      }
    }
  };
}
