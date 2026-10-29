import WebSocket, { type RawData } from "ws";
import {
  hasLabNameGitTokens,
  restoresSnapshots,
  type LabExecRequest,
  type LabOperationSupport,
  type LabSnapshotSaveRequest,
  type TopologyVariables,
  type TopoViewerNodesAction
} from "@containerlab/clab-ui/host";

import { c9sPlanFields } from "../c9sPlan.ts";
import type {
  LabBackend,
  LabBackendCapabilities,
  LabBackendFeatures,
  LabHostProfile,
  LabRuntimeKind,
  LabEvent,
  LabEventStreamOptions,
  LabFileContent,
  LabFileSystem,
  LabLifecycleAction,
  LabStatsStreamOptions,
  LabTarget,
  LifecycleRunOptions,
  LifecycleStreamEvent,
  NodeLogStreamOptions,
  RenderedTopology,
  TerminalClientMessage,
  TerminalCreateOptions,
  TerminalServerMessage,
  TerminalStream,
  TopologyFileSystem,
  TopologyFilesOptions,
  WiresharkVncRequest,
  WiresharkVncResponse,
  WiresharkVncSocket,
  WorkspaceFileEvent
} from "../contract/backend.ts";
import type {
  CaptureInterface,
  CaptureStreamOptions,
  CaptureTarget,
  ExecResponse,
  InspectContainerInfo,
  GenerateTopologyRequest,
  GraphExportFormat,
  LabStatsSample,
  LifecycleActionResult,
  MermaidDirection,
  NetemResetRequest,
  NetemSetRequest,
  NodeLifecycleAction,
  NodeLogLine,
  ShareToolAction,
  ShareToolOptions,
  ValidateTopologyResponse
} from "../contract/dto.ts";
import { captureLimits, captureNodeTargets, pcapngBlocks } from "../capture.ts";
import { LabBackendError } from "../contract/errors.ts";
import { containerRuntimeFeatures } from "../contract/support.ts";
import { readJsonLines, readLines, withIdleTimeout } from "../ndjson.ts";
import { gottyOptionsError } from "../shareOptions.ts";
import { buildWebSocketUrl, ClabApiClient, type ServerHealth } from "./clabApiClient.ts";
import { ClabApiFileSystemAdapter } from "./clabApiFileSystem.ts";
import { apiFetch } from "./upstreamRequest.ts";
import { apiTlsWebSocketOptions } from "./upstreamTls.ts";
import { rawDataToBytes, wrapWebSocket } from "../webSocket.ts";

export interface ApiLabBackendOptions {
  baseUrl: string;
  token: string;
  /** A client to use instead of one for `baseUrl`, e.g. a test double. */
  client?: ClabApiClient;
}

/** Lab hosts send a heartbeat every 25 s on event streams; silence for longer means it is gone. */
const STREAM_IDLE_TIMEOUT_MS = 60_000;

const API_CAPABILITIES: LabBackendCapabilities = {
  sshAccess: true,
  deployFromUrl: true,
  importFromUrl: true,
  edgesharkManagement: true,
  wiresharkVnc: true,
  healthMetrics: true,
  sharedWorkspace: true,
  tailscaleStatus: true
};

/** Features clab-api-server lists in `/health`, by the operation that needs them. */
const SERVER_FEATURES = {
  execFilters: "exec-filters",
  labLifecycleNodeFilter: "lab-lifecycle-node-filter",
  saveCopy: "save-copy",
  inspectDetails: "inspect-details",
  snapshotSave: "snapshot-save",
  deployRestore: "deploy-restore",
  nodeStats: "node-stats",
  logStream: "log-stream",
  terminalResume: "terminal-resume",
  captureStream: "capture-stream",
  wiresharkVnc: "wireshark-vnc"
} as const;

type ServerFeature = (typeof SERVER_FEATURES)[keyof typeof SERVER_FEATURES];

/** Servers get upgraded in place; look again after a minute. */
const SERVER_FEATURES_TTL_MS = 60_000;

/** What a server's `/health` says, with its feature list as a set. */
interface ServerState {
  features: ReadonlySet<string>;
  runtime?: string;
  namespaceMode?: string;
  /** `/health` did not answer; the next call asks again. */
  unreachable?: boolean;
}

const serverHealthCache = new Map<string, { expires: number; state: Promise<ServerState> }>();

/** Forgets what servers listed, e.g. between tests that fake different servers at one URL. */
export function clearServerFeatureCache(): void {
  serverHealthCache.clear();
}

function unsupported(what: string): LabBackendError {
  return new LabBackendError(
    `This clab-api-server cannot ${what}. Update clab-api-server to use it.`,
    501
  );
}

const SERVER_RUNTIMES: readonly LabRuntimeKind[] = ["docker", "podman", "c9s"];

function isServerRuntime(value: string | undefined): value is LabRuntimeKind {
  return value !== undefined && (SERVER_RUNTIMES as readonly string[]).includes(value);
}

/**
 * The first clab-api-server release that reports its lab runtime on `/health`.
 * Servers without the field are older than c9s support, so they run Docker.
 */
const MIN_CLAB_API_SERVER_RUNTIME_VERSION = "0.10.0";

/**
 * The lab host profile of a server from its `/health`. A server that reports
 * no runtime predates c9s support: it keeps working for what Docker servers
 * always did, and the profile asks to update it for anything that needs the
 * runtime. Nothing c9s-specific is ever guessed for it.
 */
function hostProfileFromHealth(health: Pick<ServerHealth, "runtime" | "namespaceMode">): LabHostProfile {
  if (health.runtime === undefined) {
    return {
      runtime: "docker",
      updateRequired: `This clab-api-server does not report its lab runtime. Update it to ${MIN_CLAB_API_SERVER_RUNTIME_VERSION} or later.`
    };
  }
  if (!isServerRuntime(health.runtime)) {
    throw new LabBackendError(
      `This clab-api-server runs labs with "${health.runtime}", which this app does not support. Update the app.`,
      501
    );
  }
  const profile: LabHostProfile = { runtime: health.runtime };
  if (profile.runtime === "c9s" && (health.namespaceMode === "per-lab" || health.namespaceMode === "fixed")) {
    profile.namespaceMode = health.namespaceMode;
  }
  return profile;
}

/** The features of a clab-api-server from its `/health`; older servers list none. */
function featuresFromServerHealth(state: ServerState): LabBackendFeatures {
  const listed = state.features;
  // Servers without a runtime predate c9s, so they run Docker or Podman.
  const containerRuntime = state.runtime === undefined || state.runtime === "docker" || state.runtime === "podman";
  return {
    // Servers before the feature list had validate already, or answer 404.
    validate: true,
    graphMermaid: listed.has("graph-mermaid"),
    graphDot: listed.has("graph-dot"),
    sshxReaders: listed.has("sshx-readers"),
    gottyOptions: listed.has("gotty-options"),
    nodeStats: listed.has(SERVER_FEATURES.nodeStats),
    terminalResume: listed.has(SERVER_FEATURES.terminalResume),
    ...containerRuntimeFeatures(containerRuntime),
    // A c9s server picks namespaces, exposure and persistence itself, and has no manifest export.
    manifestExport: false,
    c9sDeployOptions: false,
    captureStream: listed.has(SERVER_FEATURES.captureStream),
    // Docker servers feed Wireshark VNC from Edgeshark; a c9s server from its own stream, while it runs Docker.
    captureVnc: !containerRuntime && listed.has(SERVER_FEATURES.wiresharkVnc)
  };
}

function unsupportedFeatureError(feature: string): LabBackendError {
  return new LabBackendError(
    `This lab host's clab-api-server does not support ${feature}. Update clab-api-server to use it.`,
    501
  );
}

/**
 * The container of a topology node, for servers that only take container
 * names: the node itself, `<prefix>-<lab>-<node>`, or `<prefix>-<node>`.
 */
export function containerForNode(
  labName: string,
  containers: readonly Pick<InspectContainerInfo, "name">[],
  nodeName: string
): string {
  const names = containers.map((container) => container.name);
  const match =
    names.find((name) => name === nodeName) ??
    names.find((name) => name.endsWith(`-${labName}-${nodeName}`)) ??
    names.find((name) => name.endsWith(`-${nodeName}`));
  if (!match) {
    throw new LabBackendError(`Node "${nodeName}" was not found in lab "${labName}".`, 404);
  }
  return match;
}

/** gin's own 404 for a route the server does not have, unlike a handler's JSON 404. */
function isMissingRoute(error: unknown): boolean {
  return error instanceof Error && /\(404\): 404 page not found/.test(error.message);
}

/** A lab backend for one signed-in user of a clab-api-server. */
/**
 * A c9s clab-api-server reports an apply plan as Kubernetes resource changes
 * (`runtimePlan`) and leaves its node lists empty; give the result the fields
 * a local c9s host's plan has, so pending changes and the plan dialog read alike.
 */
function withRuntimePlan(response: LifecycleActionResult): LifecycleActionResult {
  const result = response.result;
  if (typeof result !== "object" || result === null) return response;
  const record = result as Record<string, unknown>;
  const plan = record.runtimePlan;
  if (typeof plan !== "object" || plan === null) return response;
  const fields = c9sPlanFields(plan as { namespace?: unknown; changes?: unknown });
  const merged = (key: "addedNodes" | "deletedNodes" | "recreatedNodes") => [
    ...new Set([...(Array.isArray(record[key]) ? (record[key] as string[]) : []), ...fields[key]])
  ];
  return {
    ...response,
    result: {
      ...record,
      ...fields,
      deployedLab: record.deployedLab === true || fields.deployedLab,
      addedNodes: merged("addedNodes"),
      deletedNodes: merged("deletedNodes"),
      recreatedNodes: merged("recreatedNodes")
    }
  };
}

export class ApiLabBackend implements LabBackend {
  readonly kind = "api";
  readonly capabilities = API_CAPABILITIES;
  readonly client: ClabApiClient;
  readonly token: string;
  readonly fs: LabFileSystem;

  constructor(options: ApiLabBackendOptions) {
    this.client = options.client ?? new ClabApiClient({ baseUrl: options.baseUrl });
    this.token = options.token;
    this.fs = createApiFileSystem(this.client, this.token);
  }

  /** Signs in and returns a backend for the user. */
  static async login(options: {
    baseUrl: string;
    username: string;
    password: string;
    sessionDuration?: string;
  }): Promise<ApiLabBackend> {
    const client = new ClabApiClient({ baseUrl: options.baseUrl });
    const { token } = await client.login(options.username, options.password, options.sessionDuration);
    return new ApiLabBackend({ baseUrl: options.baseUrl, token });
  }

  get scope(): string {
    return this.client.getBaseUrl();
  }

  version(options: { timeoutMs?: number } = {}) {
    return this.client.getVersion(this.token, options.timeoutMs);
  }

  versionCheck() {
    return this.client.checkVersion(this.token);
  }

  healthMetrics() {
    return this.client.getHealthMetrics(this.token);
  }

  async features(): Promise<LabBackendFeatures> {
    return featuresFromServerHealth(await this.serverState());
  }

  async hostProfile(): Promise<LabHostProfile> {
    const state = await this.serverState();
    // An unreachable server is not an old one: let the error through.
    return hostProfileFromHealth(state.unreachable ? await this.client.getServerHealth() : state);
  }

  inspectAll() {
    return this.client.listLabs(this.token);
  }

  private serverState(): Promise<ServerState> {
    const key = this.client.getBaseUrl();
    const cached = serverHealthCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.state;
    const state = this.client.getServerHealth().then(
      (health): ServerState => ({
        features: new Set(health.features),
        ...(health.runtime !== undefined ? { runtime: health.runtime } : {}),
        ...(health.namespaceMode !== undefined ? { namespaceMode: health.namespaceMode } : {})
      }),
      (): ServerState => {
        // An unreachable server is asked again on the next call.
        serverHealthCache.delete(key);
        return { features: new Set(), unreachable: true };
      }
    );
    serverHealthCache.set(key, { expires: Date.now() + SERVER_FEATURES_TTL_MS, state });
    return state;
  }

  private serverFeatures(): Promise<ReadonlySet<string>> {
    return this.serverState().then((state) => state.features);
  }

  private async hasFeature(feature: ServerFeature): Promise<boolean> {
    return (await this.serverFeatures()).has(feature);
  }

  async labOperationSupport(): Promise<LabOperationSupport> {
    const features = await this.serverFeatures();
    return {
      execByLabel: features.has(SERVER_FEATURES.execFilters),
      snapshotSave: features.has(SERVER_FEATURES.snapshotSave),
      deployRestore: features.has(SERVER_FEATURES.deployRestore),
      saveCopy: features.has(SERVER_FEATURES.saveCopy),
      inspectDetails: features.has(SERVER_FEATURES.inspectDetails)
    };
  }

  async exec(lab: LabTarget, request: LabExecRequest): Promise<ExecResponse> {
    const nodes = request.nodeNames ?? [];
    const labels = request.labels ?? [];
    const { command } = request;
    if (nodes.length === 0 && labels.length === 0) {
      return this.client.execLab(this.token, lab.labName, { command });
    }
    if (await this.hasFeature(SERVER_FEATURES.execFilters)) {
      return this.client.execLab(this.token, lab.labName, { command, nodes, labels });
    }
    if (labels.length > 0) throw unsupported("run commands on nodes by label");
    // Older servers run on one container per call.
    const containers = await this.inspectLab(lab.labName);
    const responses = await Promise.all(
      nodes.map((node) =>
        this.client.execLab(this.token, lab.labName, {
          command,
          containerName: containerForNode(lab.labName, containers, node)
        })
      )
    );
    return Object.assign({}, ...responses) as ExecResponse;
  }

  async nodesAction(
    lab: LabTarget,
    nodeNames: string[],
    action: TopoViewerNodesAction
  ): Promise<LifecycleActionResult> {
    if (nodeNames.length === 0) throw new LabBackendError("Choose at least one node.", 400);
    if (await this.hasFeature(SERVER_FEATURES.labLifecycleNodeFilter)) {
      return this.client.controlLabLifecycle(this.token, lab.labName, action, {
        includeLogs: true,
        nodeFilter: nodeNames
      });
    }
    // Older servers act on the whole lab here, so go node by node.
    const containers = await this.inspectLab(lab.labName);
    for (const node of nodeNames) {
      await this.client.controlNodeLifecycle(
        this.token,
        lab.labName,
        containerForNode(lab.labName, containers, node),
        action
      );
    }
    return { message: `Nodes ${nodeNames.join(", ")}: ${action} done.` };
  }

  async saveSnapshots(lab: LabTarget, request: LabSnapshotSaveRequest) {
    if (!(await this.hasFeature(SERVER_FEATURES.snapshotSave))) {
      throw unsupported("save VM snapshots");
    }
    return this.client.saveLabSnapshots(this.token, lab.labName, {
      ...(request.nodeNames && request.nodeNames.length > 0 ? { nodes: request.nodeNames } : {}),
      ...(request.outputDir ? { outputDir: request.outputDir } : {}),
      ...(request.timeout ? { timeout: request.timeout } : {})
    });
  }

  async inspectLabDetails(lab: LabTarget) {
    if (!(await this.hasFeature(SERVER_FEATURES.inspectDetails))) {
      throw unsupported("show inspect details");
    }
    return this.client.inspectLabDetails(this.token, lab.labName);
  }

  /** A deploy that restores snapshots must not run as a plain deploy on an older server. */
  private async checkLifecycleOptions(action: LabLifecycleAction, options: LifecycleRunOptions) {
    if (
      action === "deploy" &&
      restoresSnapshots(options.lifecycleOptions) &&
      !(await this.hasFeature(SERVER_FEATURES.deployRestore))
    ) {
      throw unsupported("restore VM snapshots on deploy");
    }
  }

  inspectLab(labName: string) {
    return this.client.inspectLab(this.token, labName);
  }

  isLabRunning(labName: string) {
    return this.client.isLabRunning(this.token, labName);
  }

  async runLifecycle(
    action: LabLifecycleAction,
    lab: LabTarget,
    options: LifecycleRunOptions = {}
  ): Promise<LifecycleActionResult> {
    await this.checkLifecycleOptions(action, options);
    const { token } = this;
    const lifecycle = { cleanup: options.cleanup, lifecycleOptions: options.lifecycleOptions };
    switch (action) {
      case "deploy":
        return this.client.deployLab(token, lab.labName, {
          ...lifecycle,
          path: lab.path,
          includeLogs: true
        });
      case "destroy":
        return this.client.destroyLab(token, lab.labName, { ...lifecycle, includeLogs: true });
      case "redeploy":
        return this.client.redeployLab(token, lab.labName, { ...lifecycle, includeLogs: true });
      case "apply":
        return withRuntimePlan(
          await this.client.applyLab(
            token,
            lab.labName,
            options.dryRun === true
              ? { path: lab.path, dryRun: true }
              : { path: lab.path, includeLogs: true }
          )
        );
      case "start":
      case "stop":
      case "restart":
        return this.client.controlLabLifecycle(token, lab.labName, action, { includeLogs: true });
    }
  }

  async streamLifecycle(
    action: LabLifecycleAction,
    lab: LabTarget,
    options: LifecycleRunOptions = {}
  ): Promise<AsyncIterable<LifecycleStreamEvent>> {
    await this.checkLifecycleOptions(action, options);
    const response = await this.client.openLifecycleStream(
      this.token,
      action,
      lab.labName,
      { path: lab.path, cleanup: options.cleanup, lifecycleOptions: options.lifecycleOptions },
      { signal: options.signal }
    );
    if (!response.body) {
      throw new Error("Lifecycle stream has no response body");
    }
    return readJsonLines<LifecycleStreamEvent>(response.body);
  }

  deployFromUrl(source: { url: string; labName?: string }) {
    return this.client.deployLabFromUrl(this.token, {
      topologySourceUrl: source.url,
      labNameOverride: source.labName
    });
  }

  async save(lab: LabTarget, options: { nodeFilter?: string; copyDir?: string } = {}) {
    if (options.copyDir && !(await this.hasFeature(SERVER_FEATURES.saveCopy))) {
      throw unsupported("copy saved configs");
    }
    return this.client.saveLab(this.token, lab.labName, options);
  }

  graphDrawio(
    lab: LabTarget,
    options: { layout: "horizontal" | "vertical" | "interactive"; theme?: string }
  ) {
    return this.client.generateDrawioGraph(this.token, lab.labName, options);
  }

  fcli(lab: LabTarget, command: string) {
    return this.client.runFcliCommand(this.token, lab.labName, command);
  }

  tailscaleStatus(labName: string) {
    return this.client.getLabTailscaleStatus(this.token, labName);
  }

  async shareTool(
    tool: "sshx" | "gotty",
    labName: string,
    action: ShareToolAction,
    options: ShareToolOptions = {}
  ) {
    if (action !== "detach") {
      await this.requireShareOptions(tool, options);
    }
    return tool === "sshx"
      ? this.client.runSshxShareAction(this.token, labName, action, options)
      : this.client.runGottyShareAction(this.token, labName, action, options);
  }

  /** Refuses options an older server would silently ignore, e.g. a GoTTY password. */
  private async requireShareOptions(tool: "sshx" | "gotty", options: ShareToolOptions): Promise<void> {
    if (tool === "gotty") {
      const error = gottyOptionsError(options);
      if (error) throw new LabBackendError(error, 400);
    }
    const wantsReaders = tool === "sshx" && options.enableReaders === true;
    const wantsGottyOptions =
      tool === "gotty" &&
      (options.username !== undefined || options.password !== undefined || options.shell !== undefined);
    if (!wantsReaders && !wantsGottyOptions) return;
    const features = await this.features();
    if (wantsReaders && !features.sshxReaders) throw unsupportedFeatureError("read-only sshx links");
    if (wantsGottyOptions && !features.gottyOptions) {
      throw unsupportedFeatureError("GoTTY credentials and shell");
    }
  }

  async validate(lab: LabTarget): Promise<ValidateTopologyResponse> {
    try {
      return await this.client.validateTopology(this.token, lab.labName, lab.path);
    } catch (error) {
      throw isMissingRoute(error) ? unsupportedFeatureError("topology validation") : error;
    }
  }

  async graphExport(
    lab: LabTarget,
    format: GraphExportFormat,
    options: { direction?: MermaidDirection } = {}
  ) {
    const features = await this.features();
    if (!(format === "mermaid" ? features.graphMermaid : features.graphDot)) {
      throw unsupportedFeatureError(format === "mermaid" ? "Mermaid graphs" : "Graphviz graphs");
    }
    return this.client.generateGraphExport(this.token, lab.labName, format, {
      path: lab.path,
      direction: options.direction
    });
  }

  generateTopology(request: GenerateTopologyRequest) {
    return this.client.generateTopology(this.token, request);
  }

  exportManifests(): Promise<{ yaml: string }> {
    return Promise.reject(
      new LabBackendError("Kubernetes manifests are only exported by a c9s lab host on this machine.", 501)
    );
  }

  nodeAction(labName: string, containerName: string, action: NodeLifecycleAction) {
    return this.client.controlNodeLifecycle(this.token, labName, containerName, action);
  }

  nodeLogs(labName: string, containerName: string, options: { tail?: string } = {}) {
    return this.client.getNodeLogs(this.token, labName, containerName, options);
  }

  async streamNodeLogs(
    labName: string,
    containerName: string,
    options: NodeLogStreamOptions
  ): Promise<AsyncIterable<NodeLogLine>> {
    // Older servers send no heartbeats, so a quiet node looks like a lost host there.
    const heartbeats = await this.hasFeature(SERVER_FEATURES.logStream);
    const response = await this.client.openNodeLogStream(
      this.token,
      labName,
      containerName,
      { tail: options.tail },
      { signal: options.signal }
    );
    if (!response.body) {
      throw new Error("No log stream body");
    }
    const body = heartbeats ? withIdleTimeout(response.body, STREAM_IDLE_TIMEOUT_MS) : response.body;
    return logLines(readJsonLines<{ line?: unknown; stream?: unknown }>(body));
  }

  async streamLabStats(
    labName: string,
    options: LabStatsStreamOptions
  ): Promise<AsyncIterable<LabStatsSample>> {
    if (!(await this.hasFeature(SERVER_FEATURES.nodeStats))) {
      throw unsupported("report node CPU and memory usage");
    }
    const response = await this.client.openLabStatsStream(
      this.token,
      labName,
      { intervalSeconds: options.intervalSeconds },
      { signal: options.signal }
    );
    if (!response.body) {
      throw new Error("No stats stream body");
    }
    return readJsonLines<LabStatsSample>(withIdleTimeout(response.body, STREAM_IDLE_TIMEOUT_MS));
  }

  nodeBrowserPorts(labName: string, containerName: string) {
    return this.client.getNodeBrowserPorts(this.token, labName, containerName);
  }

  requestSshAccess(
    labName: string,
    containerName: string,
    options: { sshUsername?: string; duration?: string } = {}
  ) {
    return this.client.requestSshAccess(this.token, labName, containerName, options);
  }

  createTerminal(labName: string, containerName: string, options: TerminalCreateOptions) {
    return this.client.createTerminalSession(this.token, labName, containerName, options);
  }

  getTerminal(sessionId: string) {
    return this.client.getTerminalSession(this.token, sessionId);
  }

  closeTerminal(sessionId: string) {
    return this.client.deleteTerminalSession(this.token, sessionId);
  }

  attachTerminal(sessionId: string): Promise<TerminalStream> {
    const socket = new WebSocket(
      buildWebSocketUrl(
        this.client.getBaseUrl(),
        `/api/v1/terminal-sessions/${encodeURIComponent(sessionId)}/stream`
      ),
      { headers: { Authorization: `Bearer ${this.token}` }, ...apiTlsWebSocketOptions() }
    );
    // Output can arrive in the same tick as "open", so listen right away.
    const stream = webSocketTerminalStream(socket);
    return new Promise((resolve, reject) => {
      socket.once("open", () => {
        socket.off("error", reject);
        resolve(stream);
      });
      socket.once("error", reject);
    });
  }

  netemShow(containerName: string) {
    return this.client.showNetem(this.token, containerName);
  }

  netemSet(request: NetemSetRequest) {
    return this.client.setNetem(this.token, request);
  }

  netemReset(request: NetemResetRequest) {
    return this.client.resetNetem(this.token, request);
  }

  edgesharkStatus() {
    return this.client.getEdgeSharkStatus(this.token);
  }

  edgesharkInstall() {
    return this.client.installEdgeShark(this.token);
  }

  edgesharkUninstall() {
    return this.client.uninstallEdgeShark(this.token);
  }

  capturePacketflix(labName: string, request: { targets: CaptureTarget[]; remoteHostname?: string }) {
    return this.client.buildPacketflixCapture(this.token, labName, request);
  }

  createWiresharkVnc(labName: string, request: { targets: CaptureTarget[]; theme?: string }) {
    return this.client.createWiresharkVncSessions(this.token, labName, request);
  }

  private async requireCaptureStream(): Promise<void> {
    if (!(await this.hasFeature(SERVER_FEATURES.captureStream))) {
      throw unsupported("stream packet captures (it needs the c9s lab runtime)");
    }
  }

  async captureInterfaces(labName: string): Promise<CaptureInterface[]> {
    await this.requireCaptureStream();
    return this.client.listCaptureInterfaces(this.token, labName);
  }

  async openCaptureStream(labName: string, options: CaptureStreamOptions): Promise<AsyncIterable<Uint8Array>> {
    await this.requireCaptureStream();
    const targets = captureNodeTargets(labName, options.targets, await this.inspectLab(labName));
    const response = await this.client.openCaptureStream(
      this.token,
      labName,
      { targets, ...captureLimits(options) },
      { signal: options.signal }
    );
    if (!response.body) throw new LabBackendError("clab-api-server sent no capture stream", 502);
    return pcapngBlocks(captureBody(response.body, options.signal));
  }

  wiresharkVncReady(sessionId: string) {
    return this.client.getWiresharkVncSessionReady(this.token, sessionId);
  }

  closeWiresharkVnc(sessionId: string) {
    return this.client.deleteWiresharkVncSession(this.token, sessionId);
  }

  closeAllWiresharkVnc() {
    return this.client.deleteAllWiresharkVncSessions(this.token);
  }

  async fetchWiresharkVnc(
    sessionId: string,
    request: WiresharkVncRequest
  ): Promise<WiresharkVncResponse> {
    const response = await apiFetch(
      `${this.client.getBaseUrl()}${wiresharkVncPath(sessionId)}${request.path}`,
      {
        method: request.method,
        headers: { ...request.headers, Authorization: `Bearer ${this.token}` }
      }
    );
    return {
      status: response.status,
      headers: Array.from(response.headers.entries()),
      body: new Uint8Array(await response.arrayBuffer())
    };
  }

  connectWiresharkVnc(
    sessionId: string,
    path: string,
    options: { protocols: string[]; origin?: string }
  ): WiresharkVncSocket {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
    if (options.origin) {
      headers.Origin = options.origin;
    }
    const url = buildWebSocketUrl(this.client.getBaseUrl(), `${wiresharkVncPath(sessionId)}${path}`);
    const socketOptions = { headers, perMessageDeflate: false, ...apiTlsWebSocketOptions() };
    return wrapWebSocket(
      options.protocols.length > 0
        ? new WebSocket(url, options.protocols, socketOptions)
        : new WebSocket(url, socketOptions)
    );
  }

  listImages() {
    return this.client.listRuntimeImages(this.token);
  }

  pullImage(image: string) {
    return this.client.pullRuntimeImage(this.token, image);
  }

  removeImage(reference: string, force = false) {
    return this.client.removeRuntimeImage(this.token, reference, force);
  }

  listTopologies() {
    return this.client.listTopologies(this.token);
  }

  importTopologyFromUrl(source: { url: string; labName?: string }) {
    return this.client.importTopologyFromUrl(this.token, {
      topologySourceUrl: source.url,
      labNameOverride: source.labName
    });
  }

  topologyFiles(options: TopologyFilesOptions): TopologyFileSystem {
    const adapter = new ClabApiFileSystemAdapter({
      client: this.client,
      token: this.token,
      labName: options.labName,
      sourcePreference: options.sourcePreference,
      yamlPath: options.yamlPath,
      annotationsPath: options.annotationsPath
    });
    const { client, token } = this;
    return Object.assign(adapter, {
      revision: (path: string) =>
        client.getTopologyDocumentRevision(token, options.labName, path)
    });
  }

  runningTopologyYaml(labName: string) {
    return this.client.getLabTopologyYaml(this.token, labName);
  }

  renderTopology(lab: LabTarget, options: { varsFile?: string } = {}): Promise<RenderedTopology> {
    if (!lab.path) {
      return Promise.reject(new LabBackendError("Rendering needs the topology file path.", 400));
    }
    return this.client.renderTopology(this.token, lab.labName, lab.path, options.varsFile);
  }

  /**
   * The server's environment is not visible here, so only defaults resolve.
   * Git tokens in the lab name expand through the server's render endpoint.
   */
  async topologyVariables(
    lab: LabTarget,
    request: { labName: string; envNames: string[] }
  ): Promise<TopologyVariables> {
    const entry = lab.path
      ? (await this.listTopologies().catch(() => [])).find((topology) => topology.yamlFileName === lab.path)
      : undefined;
    let labName = request.labName;
    if (lab.path && hasLabNameGitTokens(labName)) {
      const rendered = await this.renderTopology(lab).catch(() => undefined);
      labName = rendered?.labName ?? entry?.labName ?? labName;
    }
    const absolutePath = entry?.absolutePath;
    return {
      labName,
      ...(absolutePath ? { topologyDir: absolutePath.slice(0, absolutePath.lastIndexOf("/")) || "/" } : {})
    };
  }

  async watchTopology(labName: string, path: string, signal: AbortSignal) {
    const response = await this.client.openTopologyEventStream(this.token, labName, path, {
      signal
    });
    if (!response.body) {
      throw new Error("No topology event stream body");
    }
    return readLines(response.body);
  }

  async events(options: LabEventStreamOptions, signal: AbortSignal) {
    const response = await this.client.openEventStream(this.token, options, { signal });
    if (!response.body) {
      throw new Error("No event stream body");
    }
    return readJsonLines<LabEvent>(withIdleTimeout(response.body, STREAM_IDLE_TIMEOUT_MS));
  }

  dispose(): void {}
}

/**
 * The bytes of a capture response, read from the call on (see `readLines`).
 * Aborting the request is how a capture ends from this side, so the abort
 * ends the stream instead of failing it; `pcapngBlocks` then drops a block the
 * abort cut short.
 */
function captureBody(body: AsyncIterable<Uint8Array>, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  return captureChunks(body[Symbol.asyncIterator](), signal);
}

async function* captureChunks(chunks: AsyncIterator<Uint8Array>, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  try {
    for await (const chunk of { [Symbol.asyncIterator]: () => chunks }) yield chunk;
  } catch (error) {
    if (!signal.aborted) throw error;
  }
}

function wiresharkVncPath(sessionId: string): string {
  return `/api/v1/capture/wireshark-vnc-sessions/${encodeURIComponent(sessionId)}/vnc`;
}

function createApiFileSystem(client: ClabApiClient, token: string): LabFileSystem {
  return {
    list: (path = "") => client.listWorkspaceTree(token, path),
    async read(path, options = {}): Promise<LabFileContent> {
      const response = await client.openWorkspaceFile(token, path);
      return {
        data: await readBodyWithLimit(response, options.maxBytes),
        contentType: response.headers.get("content-type") ?? "application/octet-stream"
      };
    },
    write: (path, content, contentType) =>
      typeof content === "string"
        ? client.putWorkspaceFile(token, path, content)
        : client.putWorkspaceFileBytes(token, path, content, contentType),
    delete: (path, options = {}) => client.deleteWorkspaceFile(token, path, options),
    rename: (oldPath, newPath) => client.renameWorkspaceFile(token, oldPath, newPath),
    mkdir: (path) => client.createWorkspaceDirectory(token, path),
    async watch(signal) {
      const response = await client.openWorkspaceEventStream(token, { signal });
      if (!response.body) {
        throw new Error("No workspace event stream body");
      }
      return readJsonLines<WorkspaceFileEvent>(
        withIdleTimeout(response.body, STREAM_IDLE_TIMEOUT_MS)
      );
    }
  };
}

const FILE_TOO_LARGE = "File is too large to edit in the browser.";

async function readBodyWithLimit(
  response: Awaited<ReturnType<typeof apiFetch>>,
  maxBytes: number | undefined
): Promise<Uint8Array> {
  if (maxBytes === undefined) {
    return new Uint8Array(await response.arrayBuffer());
  }
  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new LabBackendError(FILE_TOO_LARGE, 413);
  }
  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength > maxBytes) throw new LabBackendError(FILE_TOO_LARGE, 413);
    return data;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new LabBackendError(FILE_TOO_LARGE, 413);
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

/** clab-api-server closes a terminal connection with this code when another client attached. */
const TERMINAL_CLOSE_TAKEN_OVER = 4001;

/** Log lines from the NDJSON of the follow-mode logs endpoint. */
async function* logLines(
  records: AsyncIterable<{ line?: unknown; stream?: unknown }>
): AsyncGenerator<NodeLogLine> {
  for await (const record of records) {
    if (typeof record.line !== "string") continue;
    const stream = record.stream === "stdout" || record.stream === "stderr" ? record.stream : undefined;
    yield stream ? { line: record.line, stream } : { line: record.line };
  }
}

/**
 * The clab-api-server terminal protocol over a WebSocket. Messages and the
 * close that arrive before a listener subscribes are kept for it.
 */
function webSocketTerminalStream(socket: WebSocket): TerminalStream {
  const messageListeners = new Set<(message: TerminalServerMessage) => void>();
  const closeListeners = new Set<(reason: string, details: { takenOver: boolean }) => void>();
  const pending: TerminalServerMessage[] = [];
  let closedReason: string | undefined;

  socket.on("message", (data: RawData) => {
    let message: TerminalServerMessage;
    try {
      message = JSON.parse(Buffer.from(rawDataToBytes(data)).toString("utf8")) as TerminalServerMessage;
    } catch {
      return;
    }
    if (messageListeners.size === 0) {
      pending.push(message);
      return;
    }
    for (const listener of messageListeners) listener(message);
  });
  let takenOver = false;
  socket.on("close", (code: number, reason: Buffer) => {
    closedReason = reason.toString() || "Terminal closed";
    takenOver = code === TERMINAL_CLOSE_TAKEN_OVER;
    for (const listener of closeListeners) listener(closedReason, { takenOver });
  });
  socket.on("error", () => {
    // Reported through "close".
  });

  return {
    send(message: TerminalClientMessage) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(message));
      }
    },
    onMessage(listener) {
      messageListeners.add(listener);
      for (const message of pending.splice(0)) listener(message);
      return () => messageListeners.delete(listener);
    },
    onClose(listener) {
      if (closedReason !== undefined) {
        listener(closedReason, { takenOver });
        return () => {};
      }
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
    close() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, "Client closed");
      }
    }
  };
}
