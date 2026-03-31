import { useTopoViewerStore } from "@srl-labs/clab-ui";
import { createTopologySyncController } from "@srl-labs/clab-ui/host";
import {
  refreshTopologySnapshot,
  setHostContext,
  type TopologySessionClient,
  type TopologyRef
} from "@srl-labs/clab-ui/session";

import type { LabState } from "./stores/labStore";
import { getRuntimeContainersForTopology, runtimeContainersEqual } from "./runtimeData";
import {
  type DeploymentState,
  type TopologyDocEventMessage,
  type TopologyFileEntry,
  firstArgAsTopologyRef,
  isTopologyRunning,
  normalizePathValue
} from "./standaloneHostShared";

interface StandaloneTopologyManagerOptions {
  debounceMs: number;
  getSessionClient: () => TopologySessionClient;
  getLabs: () => Map<string, LabState>;
  onTopologyFilesChanged: () => void;
}

interface HostContextOptions {
  mode?: "edit" | "view";
  deploymentState?: DeploymentState;
}

export interface StandaloneTopologyManager {
  closeEventStream(): void;
  disposeCurrentSession(): Promise<void>;
  getCurrentFilePath(): string | null;
  getCurrentSessionId(): string | null;
  getCurrentTopologyRef(): TopologyRef | null;
  handleLabStateChange(previousLabs: Map<string, LabState>, nextLabs: Map<string, LabState>): void;
  invalidateTopologyFileListCache(): void;
  listTopologyFiles(): Promise<TopologyFileEntry[]>;
  loadTopologyFile(
    topologyRef: TopologyRef,
    options?: { deploymentState?: DeploymentState }
  ): Promise<void>;
  resolveApiTopologyPath(args: unknown[]): Promise<string | undefined>;
  resolveDeploymentState(topologyRef: TopologyRef): Promise<DeploymentState | undefined>;
  resolveTopologyRef(args: unknown[]): Promise<TopologyRef | undefined>;
  scheduleSnapshotRefresh(delay?: number): void;
  setAuthenticated(isAuthenticated: boolean): void;
  syncHostContext(options?: HostContextOptions): void;
}

const FILE_LIST_CACHE_TTL_MS = 1500;

export function createStandaloneTopologyManager(
  options: StandaloneTopologyManagerOptions
): StandaloneTopologyManager {
  let currentFilePath: string | null = null;
  let currentSessionId: string | null = null;
  let currentTopologyRef: TopologyRef | null = null;
  let standaloneAuthenticated = false;
  let fileListCache: { fetchedAt: number; entries: TopologyFileEntry[] } | null = null;
  let fileListInFlight: Promise<TopologyFileEntry[]> | null = null;
  let topologyEventSource: EventSource | null = null;
  let topologyEventStreamSessionId: string | null = null;

  const topologySyncController = createTopologySyncController({
    debounceMs: options.debounceMs,
    async refresh(refreshOptions = {}) {
      try {
        await refreshTopologySnapshot(refreshOptions, options.getSessionClient());
      } catch {
        // Ignore transient refresh errors; event stream updates will retry.
      }
    }
  });

  function invalidateTopologyFileListCache(): void {
    fileListCache = null;
  }

  function closeTopologyEventStream(): void {
    topologyEventSource?.close();
    topologyEventSource = null;
    topologyEventStreamSessionId = null;
  }

  function normalizeDeploymentState(value: string | undefined): DeploymentState | undefined {
    if (value === "deployed" || value === "undeployed" || value === "unknown") {
      return value;
    }
    return undefined;
  }

  function findEntryByPath(files: TopologyFileEntry[], pathValue: string): TopologyFileEntry | undefined {
    const normalized = normalizePathValue(pathValue);
    return files.find((entry) => normalizePathValue(entry.path) === normalized);
  }

  async function destroyTopologySession(sessionId: string | null): Promise<void> {
    if (!sessionId) {
      return;
    }
    try {
      await fetch(`/api/topology/sessions/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        credentials: "include"
      });
    } catch {
      // Ignore transient teardown failures; server-side TTL cleanup is a fallback.
    }
  }

  async function disposeCurrentSession(): Promise<void> {
    const sessionId = currentSessionId;
    currentSessionId = null;
    closeTopologyEventStream();
    await destroyTopologySession(sessionId);
  }

  async function createTopologySession(
    topologyRef: TopologyRef,
    hostOptions: HostContextOptions = {}
  ): Promise<{ sessionId: string; topologyRef: TopologyRef }> {
    const deploymentState =
      hostOptions.deploymentState ??
      (isTopologyRunning(topologyRef, options.getLabs()) ? "deployed" : "undeployed");
    const mode = hostOptions.mode ?? (deploymentState === "deployed" ? "view" : "edit");
    const runtimeContainers = getRuntimeContainersForTopology(topologyRef, options.getLabs());

    const response = await fetch("/api/topology/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        topologyRef,
        mode,
        deploymentState,
        runtimeContainers
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to create topology session: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      sessionId?: unknown;
      topologyRef?: TopologyRef;
    };
    if (typeof payload.sessionId !== "string" || payload.sessionId.trim().length === 0) {
      throw new Error("Topology session response is invalid");
    }
    const canonicalTopologyRef =
      payload.topologyRef && typeof payload.topologyRef === "object"
        ? payload.topologyRef
        : topologyRef;

    return {
      sessionId: payload.sessionId,
      topologyRef: canonicalTopologyRef
    };
  }

  async function ensureTopologySession(
    topologyRef: TopologyRef,
    hostOptions: HostContextOptions = {}
  ): Promise<string> {
    if (currentSessionId && currentTopologyRef?.topologyId === topologyRef.topologyId) {
      return currentSessionId;
    }

    await disposeCurrentSession();
    const session = await createTopologySession(topologyRef, hostOptions);
    currentSessionId = session.sessionId;
    currentTopologyRef = session.topologyRef;
    currentFilePath = session.topologyRef.yamlPath;
    return currentSessionId;
  }

  async function listTopologyFiles(): Promise<TopologyFileEntry[]> {
    const now = Date.now();
    if (fileListCache && now - fileListCache.fetchedAt < FILE_LIST_CACHE_TTL_MS) {
      return fileListCache.entries;
    }

    if (fileListInFlight) {
      return fileListInFlight;
    }

    fileListInFlight = (async () => {
      try {
        const response = await fetch("/files", { credentials: "include" });
        if (!response.ok) return [];
        const entries = (await response.json()) as TopologyFileEntry[];
        fileListCache = { fetchedAt: Date.now(), entries };
        return entries;
      } catch {
        return [];
      } finally {
        fileListInFlight = null;
      }
    })();

    return fileListInFlight;
  }

  function handleTopologyDocumentEvent(event: TopologyDocEventMessage): void {
    invalidateTopologyFileListCache();
    options.onTopologyFilesChanged();

    const currentRevision = useTopoViewerStore.getState().documentRevision;
    if (event.revision && event.revision === currentRevision) {
      return;
    }
    topologySyncController.schedule(0, { externalChange: true });
  }

  function ensureTopologyEventStream(): void {
    const sessionId = currentSessionId?.trim() ?? "";
    if (!standaloneAuthenticated || sessionId.length === 0) {
      closeTopologyEventStream();
      return;
    }

    if (topologyEventSource && topologyEventStreamSessionId === sessionId) {
      return;
    }

    closeTopologyEventStream();
    const es = new EventSource(`/api/topology/events?sessionId=${encodeURIComponent(sessionId)}`);
    topologyEventSource = es;
    topologyEventStreamSessionId = sessionId;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as TopologyDocEventMessage;
        if (data.type !== "topology-doc") {
          return;
        }
        handleTopologyDocumentEvent(data);
      } catch {
        // Ignore malformed topology events
      }
    };

    es.onerror = () => {
      // EventSource reconnects automatically.
    };
  }

  function syncHostContext(hostOptions: HostContextOptions = {}): void {
    const labs = options.getLabs();
    const topologyRef = currentTopologyRef;
    const isDeployed = isTopologyRunning(topologyRef ?? undefined, labs);
    const deploymentState = hostOptions.deploymentState ?? (isDeployed ? "deployed" : "undeployed");
    const mode = hostOptions.mode ?? (deploymentState === "deployed" ? "view" : "edit");
    const runtimeContainers = getRuntimeContainersForTopology(topologyRef ?? undefined, labs);

    setHostContext({
      topologyRef: topologyRef ?? undefined,
      sessionId: currentSessionId ?? undefined,
      path: topologyRef?.yamlPath ?? currentFilePath ?? "",
      mode,
      deploymentState,
      runtimeContainers
    }, options.getSessionClient());
  }

  async function resolveDeploymentState(topologyRef: TopologyRef): Promise<DeploymentState | undefined> {
    const files = await listTopologyFiles();
    const exact = findEntryByPath(files, topologyRef.yamlPath);
    const fileState = normalizeDeploymentState(exact?.deploymentState);
    if (isTopologyRunning(topologyRef, options.getLabs())) {
      return "deployed";
    }
    if (fileState) {
      return fileState;
    }
    return undefined;
  }

  async function loadTopologyFile(
    topologyRef: TopologyRef,
    loadOptions: { deploymentState?: DeploymentState } = {}
  ): Promise<void> {
    const files = await listTopologyFiles();
    const entry = findEntryByPath(files, topologyRef.yamlPath);
    if (!entry?.topologyRef) {
      throw new Error(
        `No API-backed topology file found for "${topologyRef.yamlPath}". Standalone mode only opens topologies exposed by /files.`
      );
    }
    const canonicalTopologyRef = entry.topologyRef;
    currentTopologyRef = canonicalTopologyRef;
    currentFilePath = canonicalTopologyRef.yamlPath;
    const initialDeploymentState =
      loadOptions.deploymentState ??
      (isTopologyRunning(canonicalTopologyRef, options.getLabs()) ? "deployed" : "undeployed");
    const initialMode = initialDeploymentState === "deployed" ? "view" : "edit";
    await ensureTopologySession(canonicalTopologyRef, {
      deploymentState: initialDeploymentState,
      mode: initialMode
    });
    ensureTopologyEventStream();
    syncHostContext({
      deploymentState: initialDeploymentState,
      mode: initialMode
    });
    const snapshot = await refreshTopologySnapshot({}, options.getSessionClient());

    const stateFromApi = await resolveDeploymentState(canonicalTopologyRef);
    const stateFromRunningLabs = isTopologyRunning(canonicalTopologyRef, options.getLabs())
      ? "deployed"
      : undefined;
    const resolvedState =
      loadOptions.deploymentState ??
      stateFromApi ??
      stateFromRunningLabs ??
      snapshot.deploymentState;
    const resolvedMode = resolvedState === "deployed" ? "view" : "edit";

    if (snapshot.deploymentState !== resolvedState || snapshot.mode !== resolvedMode) {
      useTopoViewerStore.getState().setInitialData({
        deploymentState: resolvedState,
        mode: resolvedMode
      });
      syncHostContext({ deploymentState: resolvedState, mode: resolvedMode });
    }
  }

  async function resolveTopologyRef(args: unknown[]): Promise<TopologyRef | undefined> {
    const files = await listTopologyFiles();
    const requestedTopologyRef = firstArgAsTopologyRef(args);
    if (!requestedTopologyRef?.yamlPath) {
      return undefined;
    }

    const exactMatch = findEntryByPath(files, requestedTopologyRef.yamlPath);
    return exactMatch?.topologyRef;
  }

  async function resolveApiTopologyPath(args: unknown[]): Promise<string | undefined> {
    const files = await listTopologyFiles();
    const requestedTopologyRef = firstArgAsTopologyRef(args);
    if (!requestedTopologyRef?.yamlPath) {
      return undefined;
    }
    const exactMatch = findEntryByPath(files, requestedTopologyRef.yamlPath);
    return exactMatch?.path;
  }

  function handleLabStateChange(previousLabs: Map<string, LabState>, nextLabs: Map<string, LabState>): void {
    if (!currentTopologyRef) {
      return;
    }

    const wasDeployed = isTopologyRunning(currentTopologyRef, previousLabs);
    const isDeployed = isTopologyRunning(currentTopologyRef, nextLabs);
    const previousRuntimeContainers = getRuntimeContainersForTopology(currentTopologyRef, previousLabs);
    const nextRuntimeContainers = getRuntimeContainersForTopology(currentTopologyRef, nextLabs);
    const runtimeChanged = !runtimeContainersEqual(previousRuntimeContainers, nextRuntimeContainers);

    if (wasDeployed !== isDeployed || (isDeployed && runtimeChanged)) {
      syncHostContext({ deploymentState: isDeployed ? "deployed" : "undeployed" });
      topologySyncController.schedule();
    }
  }

  return {
    closeEventStream: closeTopologyEventStream,
    disposeCurrentSession,
    getCurrentFilePath: () => currentFilePath,
    getCurrentSessionId: () => currentSessionId,
    getCurrentTopologyRef: () => currentTopologyRef,
    handleLabStateChange,
    invalidateTopologyFileListCache,
    listTopologyFiles,
    loadTopologyFile,
    resolveApiTopologyPath,
    resolveDeploymentState,
    resolveTopologyRef,
    scheduleSnapshotRefresh(delay = options.debounceMs) {
      topologySyncController.schedule(delay);
    },
    setAuthenticated(isAuthenticated) {
      standaloneAuthenticated = isAuthenticated;
      if (!isAuthenticated) {
        currentTopologyRef = null;
        currentFilePath = null;
        void disposeCurrentSession();
      }
      ensureTopologyEventStream();
    },
    syncHostContext
  };
}
