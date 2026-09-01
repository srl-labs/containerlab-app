import type { ClabUiHost } from "../host/contracts";
import {
  TOPOLOGY_HOST_PROTOCOL_VERSION,
  TopologySessionCore,
  type FileSystemAdapter,
  type TopologyHostResponseMessage,
  type TopologySnapshot
} from "../session";

// Read-only host for embedding clab-ui as a topology viewer. It serves a single, in-memory
// topology (clab YAML + its annotations.json) in mode "view": the canvas renders the parsed graph
// but no edit/lifecycle command is wired (view mode never dispatches them). This is the supported
// "custom ClabUiHost" pattern from INTEGRATORS.md, kept minimal — see test/ui-harness/fakeHost.ts
// for the editable counterpart.

const ROOT = "/lab";
const YAML_PATH = `${ROOT}/topology.clab.yml`;
const ANNOTATIONS_PATH = `${YAML_PATH}.annotations.json`;

function basename(filePath: string): string {
  return filePath.split("/").filter(Boolean).at(-1) ?? filePath;
}

// In-memory filesystem holding exactly the two files the snapshot is built from. Paths are matched
// by basename so the core's derived annotations path resolves regardless of how it joins segments.
class MemoryFsAdapter implements FileSystemAdapter {
  constructor(private readonly files: Map<string, string>) {}

  private resolve(filePath: string): string | undefined {
    if (this.files.has(filePath)) return filePath;
    const byBase = basename(filePath);
    for (const key of this.files.keys()) {
      if (basename(key) === byBase) return key;
    }
    return undefined;
  }

  async readFile(filePath: string): Promise<string> {
    const key = this.resolve(filePath);
    if (key === undefined) throw new Error(`ENOENT: no such file ${filePath}`);
    return this.files.get(key) as string;
  }

  // Viewer is read-only; mutations are accepted in-memory but never persisted anywhere.
  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(this.resolve(filePath) ?? filePath, content);
  }

  async unlink(filePath: string): Promise<void> {
    const key = this.resolve(filePath);
    if (key) this.files.delete(key);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const key = this.resolve(oldPath);
    if (key === undefined) throw new Error(`ENOENT: no such file ${oldPath}`);
    this.files.set(newPath, this.files.get(key) as string);
    this.files.delete(key);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.resolve(filePath) !== undefined;
  }

  dirname(filePath: string): string {
    const i = filePath.lastIndexOf("/");
    return i <= 0 ? "/" : filePath.slice(0, i);
  }

  basename(filePath: string): string {
    return basename(filePath);
  }

  join(...segments: string[]): string {
    const joined = segments.join("/").replace(/\/+/g, "/");
    return joined.startsWith("/") ? joined : `/${joined}`;
  }
}

export interface ViewerHostInput {
  /** Raw containerlab YAML (the *.clab.yml file contents). */
  yaml: string;
  /** Raw clab-ui annotations.json contents (layout/positions). Optional. */
  annotations?: string;
}

export function createViewerHost({ yaml, annotations }: ViewerHostInput): ClabUiHost {
  const files = new Map<string, string>([[YAML_PATH, yaml]]);
  if (annotations && annotations.trim() !== "") {
    files.set(ANNOTATIONS_PATH, annotations);
  }
  const core = new TopologySessionCore({
    fs: new MemoryFsAdapter(files),
    yamlFilePath: YAML_PATH,
    mode: "view",
    deploymentState: "undeployed",
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: console.error }
  });

  const noop = (): void => {};
  // A subscribe() that registers nothing and returns an unsubscribe no-op.
  const subscribe = (): (() => void) => () => {};

  return {
    postMessage: noop,
    subscribe,
    // Not a dev mock: this gates the dev explorer pane and fake traffic stats, which a viewer omits.
    meta: { isDevMock: false, disableDevMockTraffic: true },
    explorer: {
      connect: noop,
      setFilter: noop,
      invokeAction: noop,
      persistUiState: noop,
      subscribe
    },
    topoViewer: {
      runLifecycle: noop,
      cancelLifecycle: noop,
      toggleSplitView: noop,
      runNodeAction: noop,
      captureInterface: noop,
      setLinkImpairment: noop,
      saveCustomNode: noop,
      deleteCustomNode: noop,
      setDefaultCustomNode: noop,
      importCustomNodes: noop,
      requestIconList: noop,
      uploadIcon: noop,
      deleteIcon: noop,
      reconcileIcons: noop,
      exportGrafanaBundle: noop,
      dumpCssVars: noop,
      subscribe
    },
    topology: {
      async requestSnapshot(): Promise<TopologySnapshot> {
        return core.getSnapshot();
      },
      async dispatchCommand(): Promise<TopologyHostResponseMessage> {
        return {
          type: "topology-host:error",
          protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
          requestId: "",
          error: "The standalone viewer is read-only"
        };
      }
    }
  };
}
