import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologyHostSnapshotMessage,
  TopologySnapshot
} from "../core/types/messages";
import { TOPOLOGY_HOST_PROTOCOL_VERSION } from "../core/types/messages";
import type { TopologyHost } from "../core/types/topologyHost";
import { isRecord } from "../core/utilities/typeHelpers";

const TOPOLOGY_HOST_GET_SNAPSHOT = "topology-host:get-snapshot";
const TOPOLOGY_HOST_COMMAND = "topology-host:command";

function isTopologyHostCommand(value: unknown): value is TopologyHostCommand {
  if (!isRecord(value)) return false;
  if (typeof value.command !== "string") return false;
  if (value.command === "undo" || value.command === "redo") return true;
  return "payload" in value;
}

function getProtocolVersion(message: Record<string, unknown>): number | undefined {
  const protocolVersion = message.protocolVersion;
  return typeof protocolVersion === "number" ? protocolVersion : undefined;
}

function parseCommandRequest(
  message: Record<string, unknown>
): { command: TopologyHostCommand; baseRevision: number } | null {
  const baseRevisionRaw = message.baseRevision;
  const commandPayload = message.command;
  const baseRevision =
    typeof baseRevisionRaw === "number" && Number.isFinite(baseRevisionRaw)
      ? baseRevisionRaw
      : NaN;
  if (!isTopologyHostCommand(commandPayload) || !Number.isFinite(baseRevision)) {
    return null;
  }
  return { command: commandPayload, baseRevision };
}

export function buildTopologySnapshotMessage(
  snapshot: TopologySnapshot,
  reason?: "init" | "external-change" | "resync"
): TopologyHostSnapshotMessage {
  return {
    type: "topology-host:snapshot",
    protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
    snapshot,
    ...(reason ? { reason } : {})
  };
}

export interface HandleTopologyHostProtocolMessageOptions {
  host?: TopologyHost;
  message: unknown;
  onSnapshot?: (snapshot: TopologySnapshot) => void;
  onSnapshotLoadError?: (errorMessage: string) => void;
  postMessage: (message: TopologyHostResponseMessage) => void;
}

interface ParsedTopologyHostRequest {
  message: Record<string, unknown>;
  msgType: typeof TOPOLOGY_HOST_GET_SNAPSHOT | typeof TOPOLOGY_HOST_COMMAND;
  requestId: string;
  protocolVersion: number | undefined;
}

function withRequestId(
  response: TopologyHostResponseMessage,
  requestId: string
): TopologyHostResponseMessage {
  return {
    ...response,
    requestId: requestId || response.requestId || ""
  };
}

function parseTopologyHostRequest(message: unknown): ParsedTopologyHostRequest | null {
  if (!isRecord(message)) {
    return null;
  }

  const msgType = typeof message.type === "string" ? message.type : "";
  if (msgType !== TOPOLOGY_HOST_GET_SNAPSHOT && msgType !== TOPOLOGY_HOST_COMMAND) {
    return null;
  }

  return {
    message,
    msgType,
    requestId: typeof message.requestId === "string" ? message.requestId : "",
    protocolVersion: getProtocolVersion(message)
  };
}

function postProtocolError(
  postMessage: (message: TopologyHostResponseMessage) => void,
  requestId: string,
  error: string
): void {
  postMessage({
    type: "topology-host:error",
    protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
    requestId,
    error
  });
}

async function handleSnapshotRequest(
  host: TopologyHost,
  requestId: string,
  onSnapshot: ((snapshot: TopologySnapshot) => void) | undefined,
  onSnapshotLoadError: ((errorMessage: string) => void) | undefined,
  postMessage: (message: TopologyHostResponseMessage) => void
): Promise<void> {
  try {
    const snapshot = await host.getSnapshot();
    onSnapshot?.(snapshot);
    postMessage({
      ...buildTopologySnapshotMessage(snapshot, "init"),
      requestId
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    onSnapshotLoadError?.(errorMessage);
    postProtocolError(postMessage, requestId, errorMessage);
  }
}

function getResponseSnapshot(response: TopologyHostResponseMessage): TopologySnapshot | undefined {
  if (response.type === "topology-host:ack" || response.type === "topology-host:reject") {
    return response.snapshot;
  }
  return undefined;
}

async function handleCommandRequest(
  host: TopologyHost,
  request: Record<string, unknown>,
  requestId: string,
  onSnapshot: ((snapshot: TopologySnapshot) => void) | undefined,
  postMessage: (message: TopologyHostResponseMessage) => void
): Promise<void> {
  const commandData = parseCommandRequest(request);
  if (!commandData) {
    postProtocolError(postMessage, requestId, "Invalid topology host command payload");
    return;
  }

  const response = await host.applyCommand(commandData.command, commandData.baseRevision);
  const responseWithId = withRequestId(response, requestId);
  const snapshot = getResponseSnapshot(responseWithId);
  if (snapshot) {
    onSnapshot?.(snapshot);
  }
  postMessage(responseWithId);
}

export async function handleTopologyHostProtocolMessage(
  options: HandleTopologyHostProtocolMessageOptions
): Promise<boolean> {
  const { host, message, onSnapshot, onSnapshotLoadError, postMessage } = options;
  const parsedRequest = parseTopologyHostRequest(message);
  if (!parsedRequest) {
    return false;
  }
  const { message: parsedMessage, msgType, requestId, protocolVersion } = parsedRequest;
  if (protocolVersion !== TOPOLOGY_HOST_PROTOCOL_VERSION) {
    postProtocolError(
      postMessage,
      requestId,
      `Unsupported topology host protocol version: ${protocolVersion ?? "unknown"}`
    );
    return true;
  }

  if (!host) {
    postProtocolError(postMessage, requestId, "Topology host unavailable");
    return true;
  }

  if (msgType === TOPOLOGY_HOST_GET_SNAPSHOT) {
    await handleSnapshotRequest(host, requestId, onSnapshot, onSnapshotLoadError, postMessage);
    return true;
  }

  await handleCommandRequest(host, parsedMessage, requestId, onSnapshot, postMessage);
  return true;
}
