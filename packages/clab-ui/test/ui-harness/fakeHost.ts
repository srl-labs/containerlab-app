import type { ClabUiHost, ClabUiTopoViewerEvent } from "../../src/host/contracts";
import {
  TopologySessionCore,
  type FileSystemAdapter,
  type TopologyHostCommand,
  type TopologyHostResponseMessage,
  type TopologySnapshot
} from "../../src/session";

import { fixtureFiles, TOPOLOGY_ROOT } from "./fixtureFiles";

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
    readAnnotationsFile(filename: string): Promise<unknown>;
    readYamlFile(filename: string): Promise<string>;
    resetFiles(): Promise<void>;
    emitCurrentSnapshot(): Promise<void>;
    writeAnnotationsFile(filename: string, content: unknown): Promise<void>;
    writeYamlFile(filename: string, content: string): Promise<void>;
  };
}

export function createFakeClabUiHost(initialFixture: string | null): FakeClabUiHost {
  let files = cloneFiles();
  let fs = new MemoryFsAdapter(files);
  let currentYamlPath = toYamlPath(initialFixture);
  let core = createCore(currentYamlPath, fs);
  const messageSubscribers = new Set<(event: MessageEvent<unknown>) => void>();
  const topoViewerSubscribers = new Set<(event: ClabUiTopoViewerEvent) => void>();

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

    explorer: {
      connect() {},
      setFilter() {},
      invokeAction() {},
      persistUiState() {},
      subscribe() {
        return () => {};
      }
    },

    topoViewer: {
      runLifecycle() {},
      cancelLifecycle() {},
      toggleSplitView() {},
      runNodeAction() {},
      captureInterface() {},
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
