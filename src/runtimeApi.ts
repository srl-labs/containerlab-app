import type { TopologyRef } from "@srl-labs/clab-ui/session";

export interface RuntimeTargetRequest {
  sessionId?: string;
  topologyRef?: TopologyRef;
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

export interface NetemFields {
  delay: string;
  jitter: string;
  loss: string;
  rate: string;
  corruption: string;
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

export interface NetemShowResult {
  containerName: string;
  impairments: NetemShowResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readError(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`.trim();
  const text = await response.text().catch(() => fallback);
  if (!text) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
    if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
      return parsed.message;
    }
  } catch {
    // Fall back to raw text.
  }
  return text;
}

async function requestJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    credentials: "include",
    ...init
  });

  if (!response.ok) {
    throw new Error(await readError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function asJsonBody(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

export async function inspectAllLabs(): Promise<InspectAllLabsResponse> {
  return await requestJson<InspectAllLabsResponse>("/api/runtime/inspect/all");
}

export async function inspectLab(target: RuntimeTargetRequest): Promise<InspectLabResponse> {
  return await requestJson<InspectLabResponse>(
    "/api/runtime/inspect/lab",
    asJsonBody(target)
  );
}

export async function saveLabConfigs(input: RuntimeTargetRequest & {
  nodeName?: string;
}): Promise<SaveConfigResponse> {
  return await requestJson<SaveConfigResponse>("/api/runtime/save", asJsonBody(input));
}

export async function requestNodeSsh(input: RuntimeTargetRequest & {
  nodeName: string;
  duration?: string;
  sshUsername?: string;
}): Promise<SSHAccessResponse> {
  return await requestJson<SSHAccessResponse>("/api/runtime/ssh", asJsonBody(input));
}

export async function openTerminalSession(input: RuntimeTargetRequest & {
  nodeName: string;
  protocol: TerminalProtocol;
  cols: number;
  rows: number;
  sshUsername?: string;
  telnetPort?: number;
}): Promise<TerminalSessionInfo> {
  return await requestJson<TerminalSessionInfo>("/api/runtime/terminal-sessions", asJsonBody(input));
}

export async function fetchTerminalSession(sessionId: string): Promise<TerminalSessionInfo> {
  return await requestJson<TerminalSessionInfo>(`/api/runtime/terminal-sessions/${encodeURIComponent(sessionId)}`);
}

export async function closeTerminalSession(sessionId: string): Promise<void> {
  await requestJson<{ success: boolean }>(`/api/runtime/terminal-sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    credentials: "include"
  });
}

export function connectTerminalSessionWebSocket(sessionId: string): WebSocket {
  const url = new URL(
    `/api/runtime/terminal-sessions/${encodeURIComponent(sessionId)}/stream`,
    window.location.origin
  );
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(url);
}

export async function fetchNodeLogs(input: RuntimeTargetRequest & {
  nodeName: string;
  tail?: string;
}): Promise<LogsResponse> {
  return await requestJson<LogsResponse>("/api/runtime/logs", asJsonBody(input));
}

export async function fetchVersionInfo(): Promise<VersionResponse> {
  return await requestJson<VersionResponse>("/api/runtime/version");
}

export async function fetchVersionCheck(): Promise<VersionCheckResponse> {
  return await requestJson<VersionCheckResponse>("/api/runtime/version/check");
}

export async function fetchNetem(input: RuntimeTargetRequest & {
  nodeName: string;
}): Promise<NetemShowResult> {
  return await requestJson<NetemShowResult>("/api/runtime/netem/show", asJsonBody(input));
}

export async function setNetem(input: RuntimeTargetRequest & {
  nodeName: string;
  interfaceName: string;
  delay?: string;
  jitter?: string;
  loss?: number;
  rate?: number;
  corruption?: number;
}): Promise<void> {
  await requestJson<{ success: boolean }>("/api/runtime/netem/set", asJsonBody(input));
}

export async function resetNetem(input: RuntimeTargetRequest & {
  nodeName: string;
  interfaceName: string;
}): Promise<void> {
  await requestJson<{ success: boolean }>("/api/runtime/netem/reset", asJsonBody(input));
}

export async function createTopologyFile(input: {
  content?: string;
  fileName: string;
}): Promise<{ success: boolean; topologyRef: TopologyRef }> {
  return await requestJson<{ success: boolean; topologyRef: TopologyRef }>(
    "/api/runtime/topology-file/create",
    asJsonBody(input)
  );
}

export async function deleteTopologyFile(target: RuntimeTargetRequest): Promise<{
  path: string;
  success: boolean;
}> {
  return await requestJson<{ path: string; success: boolean }>(
    "/api/runtime/topology-file/delete",
    asJsonBody(target)
  );
}

export function netemFieldsFromShowResponse(
  response: NetemShowResponse,
  containerName: string
): Record<string, NetemFields> {
  const result: Record<string, NetemFields> = {};
  const entries = response[containerName] ?? [];
  for (const entry of entries) {
    result[entry.interface] = {
      delay: entry.delay ?? "",
      jitter: entry.jitter ?? "",
      loss: Number.isFinite(entry.packet_loss) ? String(entry.packet_loss) : "",
      rate: Number.isFinite(entry.rate) ? String(entry.rate) : "",
      corruption:
        typeof entry.corruption === "number" && Number.isFinite(entry.corruption)
          ? String(entry.corruption)
          : ""
    };
  }
  return result;
}

export function normalizeNetemFields(value: unknown): NetemFields {
  if (!isRecord(value)) {
    return { delay: "", jitter: "", loss: "", rate: "", corruption: "" };
  }
  return {
    delay: typeof value.delay === "string" ? value.delay : "",
    jitter: typeof value.jitter === "string" ? value.jitter : "",
    loss: typeof value.loss === "string" ? value.loss : "",
    rate: typeof value.rate === "string" ? value.rate : "",
    corruption: typeof value.corruption === "string" ? value.corruption : ""
  };
}
