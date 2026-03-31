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
