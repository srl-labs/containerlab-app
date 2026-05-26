import type { TopologyRef } from "@srl-labs/clab-ui/session";

import { publicAssetUrl } from "./publicAssetUrl";
import type { RuntimeTerminalProtocol, RuntimeTerminalRequest } from "./stores/runtimeUiStore";

export const DETACHED_TERMINAL_TARGET_PARAM = "target";

const VALID_TERMINAL_PROTOCOLS = new Set<RuntimeTerminalProtocol>(["ssh", "shell", "telnet", "output"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseTopologyRef(value: unknown): TopologyRef | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const topologyId = optionalString(value.topologyId);
  const labName = optionalString(value.labName);
  const yamlPath = optionalString(value.yamlPath);
  const source = value.source === "vscode" || value.source === "standalone" ? value.source : undefined;
  if (!topologyId || !labName || !yamlPath || !source) {
    return undefined;
  }
  return {
    topologyId,
    labName,
    yamlPath,
    annotationsPath: optionalString(value.annotationsPath),
    source
  };
}

function base64UrlEncode(value: string): string {
  return globalThis.btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;
  return globalThis.atob(padded);
}

function serializableTerminalTarget(target: RuntimeTerminalRequest): RuntimeTerminalRequest {
  const serializable: RuntimeTerminalRequest = {
    nodeName: target.nodeName,
    protocol: target.protocol,
    title: target.title
  };
  if (target.endpointId) serializable.endpointId = target.endpointId;
  if (target.initialOutput) serializable.initialOutput = target.initialOutput;
  if (target.sessionId) serializable.sessionId = target.sessionId;
  if (target.sshUsername) serializable.sshUsername = target.sshUsername;
  if (target.telnetPort !== undefined) serializable.telnetPort = target.telnetPort;
  if (target.topologyRef) serializable.topologyRef = target.topologyRef;
  return serializable;
}

export function encodeDetachedTerminalTarget(target: RuntimeTerminalRequest): string {
  return base64UrlEncode(encodeURIComponent(JSON.stringify(serializableTerminalTarget(target))));
}

export function decodeDetachedTerminalTarget(value: string | null | undefined): RuntimeTerminalRequest | null {
  if (!value) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(base64UrlDecode(value)));
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const nodeName = optionalString(parsed.nodeName);
  const title = optionalString(parsed.title);
  const protocol = parsed.protocol;
  if (!nodeName || !title || typeof protocol !== "string" || !VALID_TERMINAL_PROTOCOLS.has(protocol as RuntimeTerminalProtocol)) {
    return null;
  }

  const target: RuntimeTerminalRequest = {
    nodeName,
    protocol: protocol as RuntimeTerminalProtocol,
    title
  };
  const endpointId = optionalString(parsed.endpointId);
  const initialOutput = optionalString(parsed.initialOutput);
  const sessionId = optionalString(parsed.sessionId);
  const sshUsername = optionalString(parsed.sshUsername);
  const telnetPort = optionalNumber(parsed.telnetPort);
  const topologyRef = parseTopologyRef(parsed.topologyRef);
  if (endpointId) target.endpointId = endpointId;
  if (initialOutput) target.initialOutput = initialOutput;
  if (sessionId) target.sessionId = sessionId;
  if (sshUsername) target.sshUsername = sshUsername;
  if (telnetPort !== undefined) target.telnetPort = telnetPort;
  if (topologyRef) target.topologyRef = topologyRef;
  return target;
}

export function detachedTerminalTargetFromLocation(location: Location = window.location): RuntimeTerminalRequest | null {
  const params = new URLSearchParams(location.search);
  return decodeDetachedTerminalTarget(params.get(DETACHED_TERMINAL_TARGET_PARAM));
}

export function buildDetachedTerminalUrl(target: RuntimeTerminalRequest): string {
  const url = new URL(publicAssetUrl("terminal.html"), window.location.origin);
  url.searchParams.set(DETACHED_TERMINAL_TARGET_PARAM, encodeDetachedTerminalTarget(target));
  return url.toString();
}
