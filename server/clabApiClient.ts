/**
 * Typed HTTP client for clab-api-server REST endpoints.
 */

interface HttpError extends Error {
  status?: number;
}

export interface ClabApiClientOptions {
  baseUrl: string;
}

export interface LoginResponse {
  token: string;
}

export interface TopologyEntry {
  labName: string;
  yamlFileName: string;
  annotationsFileName: string;
  hasAnnotations: boolean;
  deploymentState: string;
}

export interface LifecycleActionResult {
  result?: unknown;
  message?: string;
  logs?: string[];
}

export interface InspectContainerInfo {
  name: string;
  containerId: string;
  image: string;
  kind: string;
  state: string;
  status: string;
  ipv4Address: string;
  ipv6Address: string;
  labName: string;
  labPath: string;
  absLabPath: string;
  group: string;
  owner: string;
}

export type InspectAllLabsResponse = Record<string, InspectContainerInfo[]>;
export type InspectLabResponse = InspectContainerInfo[];

export interface SaveConfigResponse {
  message: string;
  output: string;
}

export interface SSHAccessResponse {
  port: number;
  host: string;
  username: string;
  expiration: string;
  command: string;
}

export type TerminalProtocol = "ssh" | "shell" | "telnet";

export interface TerminalSessionInfo {
  sessionId: string;
  username: string;
  labName: string;
  nodeName: string;
  protocol: TerminalProtocol;
  state: string;
  createdAt: string;
  expiresAt: string;
  lastActivity: string;
  exitCode?: number | null;
  error?: string;
}

export interface LogsResponse {
  containerName: string;
  logs: string;
}

export interface VersionResponse {
  versionInfo: string;
}

export interface VersionCheckResponse {
  checkResult: string;
}

export type CustomNodeTemplate = Record<string, unknown>;

export interface CustomNodesResponse {
  customNodes: CustomNodeTemplate[];
  defaultNode: string;
}

export interface CustomIconInfo {
  name: string;
  source: "workspace" | "global";
  dataUri: string;
  format: "svg" | "png";
}

export interface IconListResponse {
  icons: CustomIconInfo[];
}

export interface IconUploadRequest {
  fileName: string;
  contentType?: string;
  dataBase64: string;
}

export interface IconUploadResponse {
  success: boolean;
  iconName: string;
}

export interface NetemSetRequest {
  containerName: string;
  interface: string;
  delay?: string;
  jitter?: string;
  loss?: number;
  rate?: number;
  corruption?: number;
}

export interface NetemResetRequest {
  containerName: string;
  interface: string;
}

export interface NetemInterfaceInfo {
  interface: string;
  delay: string;
  jitter: string;
  packet_loss: number;
  rate: number;
  corruption?: number;
}

export type NetemShowResponse = Record<string, NetemInterfaceInfo[]>;

export interface TopologyDocEvent {
  type: "topology-doc";
  labName: string;
  path: string;
  documentKind: "yaml" | "annotations";
  action: "create" | "change" | "delete" | "rename";
  revision: string;
}

type LifecycleEndpoint = "deploy" | "destroy" | "redeploy";

export class ClabApiClient {
  private readonly baseUrl: string;

  constructor(options: ClabApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  async login(username: string, password: string): Promise<LoginResponse> {
    const res = await fetch(`${this.baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Login failed: ${text}`);
    }
    return (await res.json()) as LoginResponse;
  }

  async listTopologies(token: string): Promise<TopologyEntry[]> {
    const res = await this.get(`/api/v1/labs/topology/files`, token);
    return (await res.json()) as TopologyEntry[];
  }

  async getFile(token: string, labName: string, filePath: string): Promise<string> {
    const res = await this.get(
      `/api/v1/labs/${enc(labName)}/topology/file?path=${encodeURIComponent(filePath)}`,
      token
    );
    return await res.text();
  }

  async putFile(token: string, labName: string, filePath: string, content: string): Promise<void> {
    await this.request(
      "PUT",
      `/api/v1/labs/${enc(labName)}/topology/file?path=${encodeURIComponent(filePath)}`,
      token,
      content,
      "text/plain"
    );
  }

  async headFile(token: string, labName: string, filePath: string): Promise<boolean> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/labs/${enc(labName)}/topology/file?path=${encodeURIComponent(filePath)}`,
      {
        method: "HEAD",
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    return res.ok;
  }

  async getTopologyDocumentRevision(
    token: string,
    labName: string,
    filePath: string
  ): Promise<string | undefined> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/labs/${enc(labName)}/topology/file?path=${encodeURIComponent(filePath)}`,
      {
        method: "HEAD",
        headers: { Authorization: `Bearer ${token}` }
      }
    );
    if (!res.ok) {
      return undefined;
    }
    return res.headers.get("x-topology-document-revision") ?? undefined;
  }

  async deleteFile(token: string, labName: string, filePath: string): Promise<void> {
    await this.request(
      "DELETE",
      `/api/v1/labs/${enc(labName)}/topology/file?path=${encodeURIComponent(filePath)}`,
      token
    );
  }

  async renameFile(
    token: string,
    labName: string,
    oldPath: string,
    newPath: string
  ): Promise<void> {
    await this.request(
      "POST",
      `/api/v1/labs/${enc(labName)}/topology/file/rename`,
      token,
      JSON.stringify({ oldPath, newPath }),
      "application/json"
    );
  }

  async deployLab(
    token: string,
    labName: string,
    options: { path?: string; includeLogs?: boolean } = {}
  ): Promise<LifecycleActionResult> {
    const params = new URLSearchParams();
    if (options.path) {
      params.set("path", options.path);
    }
    if (options.includeLogs) {
      params.set("includeLogs", "true");
    }
    const query = params.toString();
    const res = await this.request(
      "POST",
      `/api/v1/labs/${enc(labName)}/deploy${query ? `?${query}` : ""}`,
      token,
      JSON.stringify({}),
      "application/json"
    );
    const payload = (await res.json()) as unknown;
    return normalizeLifecycleActionResult(payload);
  }

  async destroyLab(
    token: string,
    labName: string,
    options: { cleanup?: boolean; includeLogs?: boolean } = {}
  ): Promise<LifecycleActionResult> {
    const params = new URLSearchParams();
    if (options.cleanup) {
      params.set("cleanup", "true");
    }
    if (options.includeLogs) {
      params.set("includeLogs", "true");
    }
    const query = params.toString();
    const res = await this.request(
      "DELETE",
      `/api/v1/labs/${enc(labName)}${query ? `?${query}` : ""}`,
      token
    );

    const payload = await res.json().catch(() => undefined);
    return normalizeLifecycleActionResult(payload);
  }

  async redeployLab(
    token: string,
    labName: string,
    options: { cleanup?: boolean; includeLogs?: boolean } = {}
  ): Promise<LifecycleActionResult> {
    const params = new URLSearchParams();
    if (options.cleanup) {
      params.set("cleanup", "true");
    }
    if (options.includeLogs) {
      params.set("includeLogs", "true");
    }
    const query = params.toString();
    const res = await this.request(
      "PUT",
      `/api/v1/labs/${enc(labName)}${query ? `?${query}` : ""}`,
      token,
      JSON.stringify({}),
      "application/json"
    );
    const payload = (await res.json()) as unknown;
    return normalizeLifecycleActionResult(payload);
  }

  async openLifecycleStream(
    token: string,
    endpoint: LifecycleEndpoint,
    labName: string,
    options: { path?: string; cleanup?: boolean } = {}
  ): Promise<Response> {
    const params = new URLSearchParams();
    params.set("stream", "true");

    if (endpoint === "deploy" && options.path) {
      params.set("path", options.path);
    }
    if ((endpoint === "destroy" || endpoint === "redeploy") && options.cleanup) {
      params.set("cleanup", "true");
    }

    let method = "POST";
    let path = `/api/v1/labs/${enc(labName)}/deploy`;
    let body: string | undefined = JSON.stringify({});
    let contentType: string | undefined = "application/json";

    if (endpoint === "destroy") {
      method = "DELETE";
      path = `/api/v1/labs/${enc(labName)}`;
      body = undefined;
      contentType = undefined;
    } else if (endpoint === "redeploy") {
      method = "PUT";
      path = `/api/v1/labs/${enc(labName)}`;
    }

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (contentType) {
      headers["Content-Type"] = contentType;
    }

    const res = await fetch(`${this.baseUrl}${path}?${params.toString()}`, { method, headers, body });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      const err: HttpError = new Error(`${method} ${path} failed (${res.status}): ${text}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async isLabRunning(token: string, labName: string): Promise<boolean> {
    try {
      await this.get(`/api/v1/labs/${enc(labName)}`, token);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  async listLabs(token: string): Promise<InspectAllLabsResponse> {
    const res = await this.get("/api/v1/labs", token);
    return (await res.json()) as InspectAllLabsResponse;
  }

  async inspectLab(token: string, labName: string): Promise<InspectLabResponse> {
    const res = await this.get(`/api/v1/labs/${enc(labName)}`, token);
    return (await res.json()) as InspectLabResponse;
  }

  async saveLab(
    token: string,
    labName: string,
    options: { nodeFilter?: string } = {}
  ): Promise<SaveConfigResponse> {
    const params = new URLSearchParams();
    if (options.nodeFilter) {
      params.set("nodeFilter", options.nodeFilter);
    }
    const query = params.toString();
    const res = await this.request(
      "POST",
      `/api/v1/labs/${enc(labName)}/save${query ? `?${query}` : ""}`,
      token,
      JSON.stringify({}),
      "application/json"
    );
    return (await res.json()) as SaveConfigResponse;
  }

  async requestSshAccess(
    token: string,
    labName: string,
    nodeName: string,
    options: { sshUsername?: string; duration?: string } = {}
  ): Promise<SSHAccessResponse> {
    const body = JSON.stringify({
      sshUsername: options.sshUsername,
      duration: options.duration
    });
    const res = await this.request(
      "POST",
      `/api/v1/labs/${enc(labName)}/nodes/${enc(nodeName)}/ssh`,
      token,
      body,
      "application/json"
    );
    return (await res.json()) as SSHAccessResponse;
  }

  async createTerminalSession(
    token: string,
    labName: string,
    nodeName: string,
    options: {
      protocol: TerminalProtocol;
      cols: number;
      rows: number;
      sshUsername?: string;
      telnetPort?: number;
    }
  ): Promise<TerminalSessionInfo> {
    const body = JSON.stringify({
      protocol: options.protocol,
      cols: options.cols,
      rows: options.rows,
      sshUsername: options.sshUsername,
      telnetPort: options.telnetPort
    });
    const res = await this.request(
      "POST",
      `/api/v1/labs/${enc(labName)}/nodes/${enc(nodeName)}/terminal-sessions`,
      token,
      body,
      "application/json"
    );
    return (await res.json()) as TerminalSessionInfo;
  }

  async getTerminalSession(token: string, sessionId: string): Promise<TerminalSessionInfo> {
    const res = await this.get(`/api/v1/terminal-sessions/${enc(sessionId)}`, token);
    return (await res.json()) as TerminalSessionInfo;
  }

  async deleteTerminalSession(token: string, sessionId: string): Promise<void> {
    await this.request("DELETE", `/api/v1/terminal-sessions/${enc(sessionId)}`, token);
  }

  async getNodeLogs(
    token: string,
    labName: string,
    nodeName: string,
    options: { tail?: string; follow?: boolean } = {}
  ): Promise<LogsResponse> {
    const params = new URLSearchParams();
    if (options.tail) {
      params.set("tail", options.tail);
    }
    if (options.follow) {
      params.set("follow", "true");
    }
    const query = params.toString();
    const res = await this.get(
      `/api/v1/labs/${enc(labName)}/nodes/${enc(nodeName)}/logs${query ? `?${query}` : ""}`,
      token
    );
    return (await res.json()) as LogsResponse;
  }

  async getVersion(token: string): Promise<VersionResponse> {
    const res = await this.get("/api/v1/version", token);
    return (await res.json()) as VersionResponse;
  }

  async checkVersion(token: string): Promise<VersionCheckResponse> {
    const res = await this.get("/api/v1/version/check", token);
    return (await res.json()) as VersionCheckResponse;
  }

  async getCustomNodes(token: string): Promise<CustomNodesResponse> {
    const res = await this.get("/api/v1/ui/custom-nodes", token);
    return (await res.json()) as CustomNodesResponse;
  }

  async replaceCustomNodes(
    token: string,
    customNodes: CustomNodeTemplate[]
  ): Promise<CustomNodesResponse> {
    const res = await this.request(
      "PUT",
      "/api/v1/ui/custom-nodes",
      token,
      JSON.stringify({ customNodes }),
      "application/json"
    );
    return (await res.json()) as CustomNodesResponse;
  }

  async saveCustomNode(token: string, customNode: CustomNodeTemplate): Promise<CustomNodesResponse> {
    const res = await this.request(
      "POST",
      "/api/v1/ui/custom-nodes",
      token,
      JSON.stringify(customNode),
      "application/json"
    );
    return (await res.json()) as CustomNodesResponse;
  }

  async deleteCustomNode(token: string, name: string): Promise<CustomNodesResponse> {
    const res = await this.request(
      "DELETE",
      `/api/v1/ui/custom-nodes/${enc(name)}`,
      token
    );
    return (await res.json()) as CustomNodesResponse;
  }

  async setDefaultCustomNode(token: string, name: string): Promise<CustomNodesResponse> {
    const res = await this.request(
      "POST",
      "/api/v1/ui/custom-nodes/default",
      token,
      JSON.stringify({ name }),
      "application/json"
    );
    return (await res.json()) as CustomNodesResponse;
  }

  async listGlobalIcons(token: string): Promise<IconListResponse> {
    const res = await this.get("/api/v1/ui/icons", token);
    return (await res.json()) as IconListResponse;
  }

  async uploadGlobalIcon(token: string, request: IconUploadRequest): Promise<IconUploadResponse> {
    const res = await this.request(
      "POST",
      "/api/v1/ui/icons",
      token,
      JSON.stringify(request),
      "application/json"
    );
    return (await res.json()) as IconUploadResponse;
  }

  async deleteGlobalIcon(token: string, iconName: string): Promise<void> {
    await this.request("DELETE", `/api/v1/ui/icons/${enc(iconName)}`, token);
  }

  async listLabIcons(token: string, labName: string): Promise<IconListResponse> {
    const res = await this.get(`/api/v1/labs/${enc(labName)}/ui/icons`, token);
    return (await res.json()) as IconListResponse;
  }

  async reconcileLabIcons(token: string, labName: string, usedIcons: string[]): Promise<void> {
    await this.request(
      "POST",
      `/api/v1/labs/${enc(labName)}/ui/icons/reconcile`,
      token,
      JSON.stringify({ usedIcons }),
      "application/json"
    );
  }

  async showNetem(token: string, containerName: string): Promise<NetemShowResponse> {
    const res = await this.get(
      `/api/v1/tools/netem/show?containerName=${encodeURIComponent(containerName)}`,
      token
    );
    return (await res.json()) as NetemShowResponse;
  }

  async setNetem(token: string, request: NetemSetRequest): Promise<void> {
    await this.request(
      "POST",
      "/api/v1/tools/netem/set",
      token,
      JSON.stringify(request),
      "application/json"
    );
  }

  async resetNetem(token: string, request: NetemResetRequest): Promise<void> {
    await this.request(
      "POST",
      "/api/v1/tools/netem/reset",
      token,
      JSON.stringify(request),
      "application/json"
    );
  }

  /**
   * Opens an NDJSON event stream. Returns the raw Response for streaming.
   */
  async openEventStream(
    token: string,
    options: { initialState?: boolean; interfaceStats?: boolean; interfaceStatsInterval?: string } = {}
  ): Promise<Response> {
    const params = new URLSearchParams();
    if (options.initialState !== undefined) {
      params.set("initialState", String(options.initialState));
    }
    if (options.interfaceStats !== undefined) {
      params.set("interfaceStats", String(options.interfaceStats));
    }
    if (options.interfaceStatsInterval) {
      params.set("interfaceStatsInterval", options.interfaceStatsInterval);
    }
    const qs = params.toString();
    const url = `${this.baseUrl}/api/v1/events${qs ? `?${qs}` : ""}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      throw new Error(`Failed to open event stream: ${res.status} ${res.statusText}`);
    }
    return res;
  }

  async openTopologyEventStream(
    token: string,
    labName: string,
    filePath: string
  ): Promise<Response> {
    const url =
      `${this.baseUrl}/api/v1/labs/${enc(labName)}/topology/events` +
      `?path=${encodeURIComponent(filePath)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      throw new Error(`Failed to open topology event stream: ${res.status} ${res.statusText}`);
    }
    return res;
  }

  private async get(path: string, token: string): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      const err: HttpError = new Error(`GET ${path} failed (${res.status}): ${text}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  private async request(
    method: string,
    path: string,
    token: string,
    body?: string,
    contentType?: string
  ): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (contentType) {
      headers["Content-Type"] = contentType;
    }
    const res = await fetch(`${this.baseUrl}${path}`, { method, headers, body });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      const err: HttpError = new Error(`${method} ${path} failed (${res.status}): ${text}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }
}

function enc(value: string): string {
  return encodeURIComponent(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const lines = value.filter((line): line is string => typeof line === "string");
  return lines.length > 0 ? lines : [];
}

function normalizeLifecycleActionResult(payload: unknown): LifecycleActionResult {
  if (!isRecord(payload)) {
    return { result: payload };
  }

  const logs = toStringArray(payload.logs);
  const message = typeof payload.message === "string" ? payload.message : undefined;
  const hasResultField = Object.prototype.hasOwnProperty.call(payload, "result");
  const result = hasResultField ? payload.result : payload;

  return { result, message, logs };
}

export function isNotFoundError(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("(404)");
}

export function buildWebSocketUrl(baseUrl: string, path: string): string {
  const url = new URL(path, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
