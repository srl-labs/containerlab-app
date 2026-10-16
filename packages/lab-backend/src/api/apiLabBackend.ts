import WebSocket, { type RawData } from "ws";

import type {
  LabBackend,
  LabBackendCapabilities,
  LabEvent,
  LabEventStreamOptions,
  LabFileContent,
  LabFileSystem,
  LabLifecycleAction,
  LabTarget,
  LifecycleRunOptions,
  LifecycleStreamEvent,
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
  CaptureTarget,
  LifecycleActionResult,
  NetemResetRequest,
  NetemSetRequest,
  NodeLifecycleAction,
  ShareToolAction
} from "../contract/dto.ts";
import { LabBackendError } from "../contract/errors.ts";
import { readJsonLines, readLines } from "../ndjson.ts";
import { buildWebSocketUrl, ClabApiClient } from "./clabApiClient.ts";
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

const API_CAPABILITIES: LabBackendCapabilities = {
  sshAccess: true,
  deployFromUrl: true,
  importFromUrl: true,
  edgesharkManagement: true,
  wiresharkVnc: true,
  healthMetrics: true,
  sharedWorkspace: true
};

/** A lab backend for one signed-in user of a clab-api-server. */
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

  inspectAll() {
    return this.client.listLabs(this.token);
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
        return this.client.applyLab(
          token,
          lab.labName,
          options.dryRun === true
            ? { path: lab.path, dryRun: true }
            : { path: lab.path, includeLogs: true }
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

  save(lab: LabTarget, options: { nodeFilter?: string } = {}) {
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

  shareTool(
    tool: "sshx" | "gotty",
    labName: string,
    action: ShareToolAction,
    options: { port?: number } = {}
  ) {
    return tool === "sshx"
      ? this.client.runSshxShareAction(this.token, labName, action)
      : this.client.runGottyShareAction(this.token, labName, action, options);
  }

  nodeAction(labName: string, containerName: string, action: NodeLifecycleAction) {
    return this.client.controlNodeLifecycle(this.token, labName, containerName, action);
  }

  nodeLogs(labName: string, containerName: string, options: { tail?: string } = {}) {
    return this.client.getNodeLogs(this.token, labName, containerName, options);
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
    return readJsonLines<LabEvent>(response.body);
  }

  dispose(): void {}
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
      return readJsonLines<WorkspaceFileEvent>(response.body);
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

/**
 * The clab-api-server terminal protocol over a WebSocket. Messages and the
 * close that arrive before a listener subscribes are kept for it.
 */
function webSocketTerminalStream(socket: WebSocket): TerminalStream {
  const messageListeners = new Set<(message: TerminalServerMessage) => void>();
  const closeListeners = new Set<(reason: string) => void>();
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
  socket.on("close", (_code: number, reason: Buffer) => {
    closedReason = reason.toString() || "Terminal closed";
    for (const listener of closeListeners) listener(closedReason);
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
        listener(closedReason);
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
