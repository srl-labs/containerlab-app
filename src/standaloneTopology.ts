import { useTopoViewerStore } from "@srl-labs/clab-ui";
import { createTopologySyncController } from "@srl-labs/clab-ui/host";
import {
  refreshTopologySnapshot,
  setHostContext,
  type TopologySessionClient,
  type TopologyRef
} from "@srl-labs/clab-ui/session";

import { fetchUiIcons } from "./runtimeApi";
import { getRuntimeContainersForTopology, runtimeContainersEqual } from "./runtimeData";
import type { EndpointConfig } from "./stores/endpointStore";
import type { LabState } from "./stores/labStore";
import { connectedEndpoints, isConnectedEndpointId } from "./standaloneEndpointSelection";
import { standaloneServerUrl } from "./standaloneServerOrigin";
import {
  extractEndpointIdFromTopologyId,
  type DeploymentState,
  type ExplorerTreeItem,
  type LoadTopologyTarget,
  type TopologyDocEventMessage,
  type TopologyFileEntry,
  type TopologySourcePreference,
  firstArgAsTopologyRef,
  firstArgAsTreeItem,
  findTopologyFileEntryByPath,
  isTopologyRunning,
  normalizeLabName,
  normalizePathValue,
  resolveStandaloneLoadTopologyTarget,
  topologyEntryLabName,
  topologyPathsLikelyMatch
} from "./standaloneHostShared";

interface StandaloneTopologyManagerOptions {
  debounceMs: number;
  getEndpoints: () => EndpointConfig[];
  getLabs: () => Map<string, LabState>;
  getDefaultEndpointId?: () => string | undefined;
  getSessionClient: () => TopologySessionClient;
  onTopologyFilesChanged: () => void;
}

interface HostContextOptions {
  deploymentState?: DeploymentState;
  mode?: "edit" | "view";
  sourcePreference?: TopologySourcePreference;
}

export interface StandaloneTopologyManager {
  clearActiveTopology(): Promise<void>;
  closeEventStream(): void;
  disposeCurrentSession(): Promise<void>;
  disposeEndpointSession(endpointId: string): Promise<void>;
  getCurrentEndpointId(): string | null;
  getCurrentFilePath(): string | null;
  getCurrentSessionId(): string | null;
  getCurrentTopologyRef(): TopologyRef | null;
  handleLabStateChange(previousLabs: Map<string, LabState>, nextLabs: Map<string, LabState>): void;
  invalidateTopologyFileListCache(endpointId?: string): void;
  listTopologyFiles(): Promise<TopologyFileEntry[]>;
  listTopologyFilesForEndpoint(endpointId: string): Promise<TopologyFileEntry[]>;
  loadTopologyFile(
    topologyRef: TopologyRef,
    options?: { deploymentState?: DeploymentState; endpointId?: string }
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
  let currentEndpointId: string | null = null;
  let currentFilePath: string | null = null;
  let currentSessionId: string | null = null;
  let currentTopologyRef: TopologyRef | null = null;
  let currentSourcePreference: TopologySourcePreference = "api-file";
  let standaloneAuthenticated = false;
  const fileListCache = new Map<string, { entries: TopologyFileEntry[]; fetchedAt: number }>();
  const fileListInFlight = new Map<string, Promise<TopologyFileEntry[]>>();
  let topologyEventSource: EventSource | null = null;
  let topologyEventStreamEndpointId: string | null = null;
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

  function resolveFallbackEndpointId(): string | undefined {
    return options.getDefaultEndpointId?.() ?? options.getEndpoints()[0]?.id;
  }

  function resolveTopologyEndpointId(
    topologyRef: Pick<TopologyRef, "topologyId"> | undefined,
    explicitEndpointId?: string
  ): string | undefined {
    return (
      explicitEndpointId ??
      extractEndpointIdFromTopologyId(topologyRef?.topologyId) ??
      currentEndpointId ??
      resolveFallbackEndpointId()
    );
  }

  function invalidateTopologyFileListCache(endpointId?: string): void {
    if (endpointId) {
      fileListCache.delete(endpointId);
      fileListInFlight.delete(endpointId);
      return;
    }
    fileListCache.clear();
    fileListInFlight.clear();
  }

  function closeTopologyEventStream(): void {
    topologyEventSource?.close();
    topologyEventSource = null;
    topologyEventStreamEndpointId = null;
    topologyEventStreamSessionId = null;
  }

  function normalizeDeploymentState(value: string | undefined): DeploymentState | undefined {
    if (value === "deployed" || value === "undeployed" || value === "unknown") {
      return value;
    }
    return undefined;
  }

  function findEntriesByPathHint(
    files: TopologyFileEntry[],
    pathValue: string | undefined
  ): TopologyFileEntry[] {
    if (!pathValue) {
      return [];
    }
    const normalizedPath = normalizePathValue(pathValue);
    if (!normalizedPath) {
      return [];
    }
    const exactMatches = files.filter((entry) => normalizePathValue(entry.path) === normalizedPath);
    if (exactMatches.length > 0) {
      return exactMatches;
    }
    return files.filter((entry) => topologyPathsLikelyMatch(entry.path, normalizedPath));
  }

  function findEntriesByLabName(
    files: TopologyFileEntry[],
    labNameValue: string | undefined
  ): TopologyFileEntry[] {
    const normalizedLabName = normalizeLabName(labNameValue);
    if (!normalizedLabName) {
      return [];
    }
    return files.filter((entry) => normalizeLabName(topologyEntryLabName(entry)) === normalizedLabName);
  }

  function extractLabNameFromLabel(label: unknown): string | undefined {
    if (typeof label !== "string") {
      return undefined;
    }
    const trimmed = label.trim();
    if (!trimmed) {
      return undefined;
    }
    const withOwnerSuffix = trimmed.match(/^(.+?)\s+\([^()]+\)$/);
    return withOwnerSuffix?.[1]?.trim() || trimmed;
  }

  function topologyCandidateFiles(
    files: TopologyFileEntry[],
    topologyRef: TopologyRef | undefined,
    item: ExplorerTreeItem | undefined
  ): TopologyFileEntry[] {
    const requestedEndpointId = item?.endpointId ?? resolveTopologyEndpointId(topologyRef);
    return requestedEndpointId
      ? files.filter((entry) => entry.endpointId === requestedEndpointId)
      : files;
  }

  function topologyPathHints(
    topologyRef: TopologyRef | undefined,
    item: ExplorerTreeItem | undefined
  ): string[] {
    return [
      topologyRef?.yamlPath,
      typeof item?.description === "string" ? item.description : undefined,
      typeof item?.tooltip === "string" ? item.tooltip : undefined
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  }

  function uniquePathMatches(
    files: TopologyFileEntry[],
    pathHints: string[]
  ): { exact: TopologyFileEntry | undefined; aggregate: TopologyFileEntry[] } {
    const aggregate: TopologyFileEntry[] = [];
    for (const pathHint of pathHints) {
      const matches = findEntriesByPathHint(files, pathHint);
      if (matches.length === 1) {
        return { exact: matches[0], aggregate };
      }
      for (const match of matches) {
        if (!aggregate.some((entry) => entry.path === match.path)) {
          aggregate.push(match);
        }
      }
    }
    return { exact: undefined, aggregate };
  }

  function resolveEntryFromNameAndPathMatches(
    files: TopologyFileEntry[],
    labNameHint: string | undefined,
    pathMatches: TopologyFileEntry[]
  ): TopologyFileEntry | undefined {
    const nameMatches = findEntriesByLabName(files, labNameHint);
    if (nameMatches.length === 1) {
      return nameMatches[0];
    }
    if (nameMatches.length > 1 && pathMatches.length > 0) {
      const intersection = nameMatches.filter((entry) =>
        pathMatches.some((candidate) => candidate.path === entry.path)
      );
      return intersection.length === 1 ? intersection[0] : undefined;
    }
    return pathMatches.length === 1 ? pathMatches[0] : undefined;
  }

  function resolveTopologyEntryFromArgs(
    files: TopologyFileEntry[],
    args: unknown[]
  ): TopologyFileEntry | undefined {
    const requestedTopologyRef = firstArgAsTopologyRef(args);
    const item = firstArgAsTreeItem(args);
    const candidateFiles = topologyCandidateFiles(files, requestedTopologyRef, item);
    const { exact, aggregate } = uniquePathMatches(candidateFiles, topologyPathHints(requestedTopologyRef, item));
    if (exact) {
      return exact;
    }

    const labNameHint =
      requestedTopologyRef?.labName ??
      item?.labName ??
      extractLabNameFromLabel(item?.label);
    return resolveEntryFromNameAndPathMatches(candidateFiles, labNameHint, aggregate);
  }

  function withEndpointHeaders(endpointId: string | undefined, init: RequestInit = {}): RequestInit {
    if (!endpointId) {
      return init;
    }
    const headers = new Headers(init.headers);
    headers.set("x-endpoint-id", endpointId);
    return {
      ...init,
      headers
    };
  }

  async function fetchTopologyFilesForEndpoint(endpointId: string): Promise<TopologyFileEntry[]> {
    try {
      const response = await fetch("/files", withEndpointHeaders(endpointId, { credentials: "include" }));
      if (!response.ok) {
        return [];
      }
      return (await response.json()) as TopologyFileEntry[];
    } catch {
      return [];
    }
  }

  async function listTopologyFilesForEndpoint(endpointId: string): Promise<TopologyFileEntry[]> {
    if (!isConnectedEndpointId(options.getEndpoints(), endpointId)) {
      fileListCache.delete(endpointId);
      fileListInFlight.delete(endpointId);
      return [];
    }

    const cached = fileListCache.get(endpointId);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < FILE_LIST_CACHE_TTL_MS) {
      return cached.entries;
    }

    const inFlight = fileListInFlight.get(endpointId);
    if (inFlight) {
      return inFlight;
    }

    const request = (async () => {
      try {
        const entries = await fetchTopologyFilesForEndpoint(endpointId);
        fileListCache.set(endpointId, { entries, fetchedAt: Date.now() });
        return entries;
      } finally {
        fileListInFlight.delete(endpointId);
      }
    })();

    fileListInFlight.set(endpointId, request);
    return await request;
  }

  async function listTopologyFiles(): Promise<TopologyFileEntry[]> {
    const endpoints = connectedEndpoints(options.getEndpoints());
    if (endpoints.length === 0) {
      return [];
    }
    const filesByEndpoint = await Promise.all(
      endpoints.map((endpoint) => listTopologyFilesForEndpoint(endpoint.id))
    );
    return filesByEndpoint.flat();
  }

  async function destroyTopologySession(
    sessionId: string | null,
    endpointId: string | null = currentEndpointId
  ): Promise<void> {
    if (!sessionId) {
      return;
    }
    try {
      await fetch(
        `/api/topology/sessions/${encodeURIComponent(sessionId)}`,
        withEndpointHeaders(endpointId ?? undefined, {
          method: "DELETE",
          credentials: "include"
        })
      );
    } catch {
      // Ignore transient teardown failures; server-side TTL cleanup is a fallback.
    }
  }

  async function disposeCurrentSession(): Promise<void> {
    const endpointId = currentEndpointId;
    const sessionId = currentSessionId;
    currentSessionId = null;
    currentEndpointId = null;
    currentSourcePreference = "api-file";
    closeTopologyEventStream();
    useTopoViewerStore.getState().setCustomIcons([]);
    await destroyTopologySession(sessionId, endpointId);
  }

  async function clearActiveTopology(): Promise<void> {
    currentTopologyRef = null;
    currentFilePath = null;
    currentSourcePreference = "api-file";
    await disposeCurrentSession();
    setHostContext(
      {
        topologyRef: undefined,
        sessionId: undefined,
        path: "",
        mode: "edit",
        deploymentState: "unknown",
        runtimeContainers: []
      },
      options.getSessionClient()
    );
    useTopoViewerStore.getState().setInitialData({
      labName: "",
      mode: "edit",
      deploymentState: "unknown"
    });
  }

  async function createTopologySession(
    topologyRef: TopologyRef,
    hostOptions: HostContextOptions = {},
    endpointIdOverride?: string
  ): Promise<{ endpointId: string; sessionId: string; topologyRef: TopologyRef }> {
    const endpointId = resolveTopologyEndpointId(topologyRef, endpointIdOverride);
    if (!endpointId) {
      throw new Error("No endpoint is available for this topology.");
    }

    const deploymentState =
      hostOptions.deploymentState ??
      (isTopologyRunning(topologyRef, options.getLabs()) ? "deployed" : "undeployed");
    const mode = hostOptions.mode ?? (deploymentState === "deployed" ? "view" : "edit");
    const runtimeContainers = getRuntimeContainersForTopology(topologyRef, options.getLabs());

    const response = await fetch(
      "/api/topology/sessions",
      withEndpointHeaders(endpointId, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          topologyRef,
          mode,
          deploymentState,
          sourcePreference: hostOptions.sourcePreference ?? "api-file",
          runtimeContainers
        })
      })
    );

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
      endpointId: resolveTopologyEndpointId(canonicalTopologyRef, endpointId) ?? endpointId,
      sessionId: payload.sessionId,
      topologyRef: canonicalTopologyRef
    };
  }

  async function ensureTopologySession(
    topologyRef: TopologyRef,
    hostOptions: HostContextOptions = {},
    endpointIdOverride?: string
  ): Promise<string> {
    const endpointId = resolveTopologyEndpointId(topologyRef, endpointIdOverride) ?? null;
    if (
      currentSessionId &&
      currentTopologyRef?.topologyId === topologyRef.topologyId &&
      currentEndpointId === endpointId
    ) {
      return currentSessionId;
    }

    await disposeCurrentSession();
    const session = await createTopologySession(topologyRef, hostOptions, endpointIdOverride);
    currentSessionId = session.sessionId;
    currentTopologyRef = session.topologyRef;
    currentFilePath = session.topologyRef.yamlPath;
    currentEndpointId = session.endpointId;
    currentSourcePreference = hostOptions.sourcePreference ?? "api-file";
    return currentSessionId;
  }

  function handleTopologyDocumentEvent(event: TopologyDocEventMessage): void {
    invalidateTopologyFileListCache(currentEndpointId ?? undefined);
    options.onTopologyFilesChanged();

    const currentRevision = useTopoViewerStore.getState().documentRevision;
    if (event.revision && event.revision === currentRevision) {
      return;
    }
    topologySyncController.schedule(0, { externalChange: true });
  }

  function ensureTopologyEventStream(): void {
    const sessionId = currentSessionId?.trim() ?? "";
    const endpointId = currentEndpointId?.trim() ?? "";
    if (
      !standaloneAuthenticated ||
      sessionId.length === 0 ||
      endpointId.length === 0 ||
      currentSourcePreference === "running-lab-doc"
    ) {
      closeTopologyEventStream();
      return;
    }

    if (
      topologyEventSource &&
      topologyEventStreamSessionId === sessionId &&
      topologyEventStreamEndpointId === endpointId
    ) {
      return;
    }

    closeTopologyEventStream();
    const url = new URL(standaloneServerUrl("/api/topology/events"));
    url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("endpointId", endpointId);
    const source = new EventSource(url, { withCredentials: true });
    topologyEventSource = source;
    topologyEventStreamEndpointId = endpointId;
    topologyEventStreamSessionId = sessionId;

    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as TopologyDocEventMessage;
        if (data.type !== "topology-doc") {
          return;
        }
        handleTopologyDocumentEvent(data);
      } catch {
        // Ignore malformed topology events.
      }
    };

    source.onerror = () => {
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

    setHostContext(
      {
        topologyRef: topologyRef ?? undefined,
        sessionId: currentSessionId ?? undefined,
        path: topologyRef?.yamlPath ?? currentFilePath ?? "",
        mode,
        deploymentState,
        runtimeContainers
      },
      options.getSessionClient()
    );
  }

  async function resolveDeploymentState(topologyRef: TopologyRef): Promise<DeploymentState | undefined> {
    const endpointId = resolveTopologyEndpointId(topologyRef);
    const files = endpointId ? await listTopologyFilesForEndpoint(endpointId) : await listTopologyFiles();
    const exact = findTopologyFileEntryByPath(files, topologyRef.yamlPath);
    const fileState = normalizeDeploymentState(exact?.deploymentState);
    if (isTopologyRunning(topologyRef, options.getLabs())) {
      return "deployed";
    }
    if (fileState) {
      return fileState;
    }
    return undefined;
  }

  async function resolveLoadTopologyTarget(
    topologyRef: TopologyRef,
    endpointId: string,
    loadOptions: { deploymentState?: DeploymentState; endpointId?: string }
  ): Promise<LoadTopologyTarget> {
    const files = await listTopologyFilesForEndpoint(endpointId);
    const target = resolveStandaloneLoadTopologyTarget({
      topologyRef,
      endpointId,
      deploymentState: loadOptions.deploymentState,
      endpoints: options.getEndpoints(),
      files,
      labs: options.getLabs()
    });
    if (!target) {
      throw new Error(
        `No API-backed topology file found for "${topologyRef.yamlPath}". Standalone mode only opens topologies exposed by /files.`
      );
    }
    return target;
  }

  async function loadCustomIconsForTopology(topologyRef: TopologyRef): Promise<void> {
    try {
      const iconList = await fetchUiIcons({
        endpointId: currentEndpointId ?? undefined,
        sessionId: currentSessionId ?? undefined,
        topologyRef
      });
      useTopoViewerStore.getState().setCustomIcons(iconList.icons);
    } catch {
      useTopoViewerStore.getState().setCustomIcons([]);
    }
  }

  async function resolveLoadedTopologyState(
    topologyRef: TopologyRef,
    snapshotState: DeploymentState,
    requestedState: DeploymentState | undefined
  ): Promise<DeploymentState> {
    const stateFromApi = await resolveDeploymentState(topologyRef);
    const stateFromRunningLabs = isTopologyRunning(topologyRef, options.getLabs())
      ? "deployed"
      : undefined;
    return requestedState ?? stateFromApi ?? stateFromRunningLabs ?? snapshotState;
  }

  async function loadTopologyFile(
    topologyRef: TopologyRef,
    loadOptions: { deploymentState?: DeploymentState; endpointId?: string } = {}
  ): Promise<void> {
    const endpointId = resolveTopologyEndpointId(topologyRef, loadOptions.endpointId);
    if (!endpointId) {
      throw new Error("No endpoint is available for this topology.");
    }

    const { canonicalTopologyRef, canonicalEndpointId, sourcePreference } =
      await resolveLoadTopologyTarget(topologyRef, endpointId, loadOptions);
    useTopoViewerStore.getState().setCustomIcons([]);
    const initialDeploymentState =
      loadOptions.deploymentState ??
      (isTopologyRunning(canonicalTopologyRef, options.getLabs()) ? "deployed" : "undeployed");
    const initialMode = initialDeploymentState === "deployed" ? "view" : "edit";
    await ensureTopologySession(canonicalTopologyRef, {
      deploymentState: initialDeploymentState,
      mode: initialMode,
      sourcePreference
    }, canonicalEndpointId);
    ensureTopologyEventStream();
    syncHostContext({
      deploymentState: initialDeploymentState,
      mode: initialMode
    });
    await loadCustomIconsForTopology(canonicalTopologyRef);
    const snapshot = await refreshTopologySnapshot({}, options.getSessionClient());

    const resolvedState = await resolveLoadedTopologyState(
      canonicalTopologyRef,
      snapshot.deploymentState,
      loadOptions.deploymentState
    );
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
    return resolveTopologyEntryFromArgs(files, args)?.topologyRef;
  }

  async function resolveApiTopologyPath(args: unknown[]): Promise<string | undefined> {
    const files = await listTopologyFiles();
    return resolveTopologyEntryFromArgs(files, args)?.path;
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
    clearActiveTopology,
    closeEventStream: closeTopologyEventStream,
    disposeCurrentSession,
    async disposeEndpointSession(endpointId) {
      if (currentEndpointId === endpointId) {
        await disposeCurrentSession();
      }
    },
    getCurrentEndpointId: () => currentEndpointId,
    getCurrentFilePath: () => currentFilePath,
    getCurrentSessionId: () => currentSessionId,
    getCurrentTopologyRef: () => currentTopologyRef,
    handleLabStateChange,
    invalidateTopologyFileListCache,
    listTopologyFiles,
    listTopologyFilesForEndpoint,
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
        currentEndpointId = null;
        currentTopologyRef = null;
        currentFilePath = null;
        useTopoViewerStore.getState().setCustomIcons([]);
        void disposeCurrentSession();
      }
      ensureTopologyEventStream();
    },
    syncHostContext
  };
}
