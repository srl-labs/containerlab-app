/**
 * The contract of a lab's fcling engine (`fcling serve`), shared by the lab
 * backends, the hosts and the Fabric view. No React in here: backends import it.
 */

/**
 * The container image of fcling, for one-shot reports and the engine. Pinned:
 * the Fabric view reads the fields of its API, so a new release is a change to
 * test and bump here, with clab-api-server's `DefaultImage`.
 */
export const FCLING_IMAGE = "ghcr.io/srl-labs/fcling:0.9.0";

/** The port `fcling serve` listens on inside its container. */
export const FCLING_PORT = 8765;

/** Where fcling looks for a lab's nodes unless told otherwise. */
export const FCLING_DEFAULT_GNMI_PORT = 57400;

export function isValidGnmiPort(port: unknown): port is number {
  return typeof port === "number" && Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** fcling's global option for a port, before its command. Its default needs none. */
export function fclingGnmiPortArgs(port: number | undefined): string[] {
  return port === undefined || port === FCLING_DEFAULT_GNMI_PORT ? [] : ["-p", String(port)];
}

/** Wide enough for every report: without a terminal, fcling squeezes its tables into 80 columns. */
export const FCLING_REPORT_COLUMNS = 400;

export type FclingEngineState = "stopped" | "starting" | "ready" | "failed";

export interface FclingEngineStatus {
  state: FclingEngineState;
  image?: string;
  containerName?: string;
  /** ISO time the container started. */
  startedAt?: string;
  /**
   * The port it reaches the lab's nodes on, or will when it starts. A lab host
   * too old to say this also cannot change it.
   */
  gnmiPort?: number;
  /** Why it failed: the end of its log. */
  error?: string;
}

export interface FclingEngineStartOptions {
  /**
   * A new port for the lab's nodes, kept for the next start and used for its
   * reports. An engine on another port is replaced, and keeps its history.
   */
  gnmiPort?: number;
}

export type FclingApiMethod = "GET" | "POST" | "DELETE";

/** One call to the engine's HTTP API. */
export interface FclingApiRequest {
  method: FclingApiMethod;
  /** Below `/api/`, without a leading slash, such as `reports/bgp-peers`. */
  path: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface FclingApiResponse {
  status: number;
  body: unknown;
}

/** One server-sent event of the engine: its JSON, with the `type` the engine gives every event. */
export interface FclingEvent {
  type: string;
  /** Sequence number of a `change`, to catch up from after a reconnect. */
  seq?: number;
  [field: string]: unknown;
}

/** An API call that failed, with the status the engine or a host answered. */
export class FabricApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "FabricApiError";
    this.status = status;
  }
}

/**
 * The engine's API routes the Fabric view may use, by method. Anything else,
 * `chat` and `/mcp` among them, is refused by every host.
 */
const READ_ROUTES: ReadonlySet<string> = new Set([
  "status",
  "reports",
  "checks",
  "incidents",
  "acks",
  "history",
  "drift",
  "configs",
  "configs/diff",
  "baselines",
  "lenses",
  "topology"
]);

/** Routes with a name below them: a report, a lens, a baseline. */
const READ_NAMED_ROUTES: ReadonlySet<string> = new Set(["reports", "lenses"]);

const WRITE_ROUTES: Readonly<Record<"POST" | "DELETE", ReadonlySet<string>>> = {
  POST: new Set(["acks", "baselines"]),
  DELETE: new Set(["acks"])
};

/** One path segment, however it is encoded: never a way up or further down. */
function isPlainName(name: string): boolean {
  try {
    const decoded = decodeURIComponent(name);
    return decoded !== "" && !decoded.includes("/") && !/^\.+$/.test(decoded);
  } catch {
    return false;
  }
}

/** Whether the Fabric view may make this call. The event stream has its own way. */
export function isFclingApiCallAllowed(method: string, path: string): boolean {
  const [parent = "", name] = path.split(/\/(.*)/s);
  if (method === "GET") {
    if (READ_ROUTES.has(path)) return true;
    return READ_NAMED_ROUTES.has(parent) && name !== undefined && isPlainName(name);
  }
  if (method === "POST") return WRITE_ROUTES.POST.has(path);
  if (method !== "DELETE") return false;
  if (WRITE_ROUTES.DELETE.has(path)) return true;
  return parent === "baselines" && name !== undefined && isPlainName(name);
}

/** The query string of a call, repeating a parameter given as a list, with its `?`; or nothing. */
export function fclingQueryString(query: FclingApiRequest["query"]): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined && item !== "") search.append(name, item);
    }
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function parseEventBlock(block: string): FclingEvent | undefined {
  const data: string[] = [];
  let failed = false;
  for (const line of block.split("\n")) {
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    else if (line.trim() === "event: error") failed = true;
  }
  if (data.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.join("\n"));
  } catch {
    // Not an event of the engine's: its stream carries only JSON.
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const event = parsed as Record<string, unknown>;
  // How the app server says that the stream it passes on failed.
  if (failed) throw new Error(typeof event.error === "string" ? event.error : "The event stream failed");
  return typeof event.type === "string" ? (event as FclingEvent) : undefined;
}

/** The events of a server-sent event stream. Keep-alive comments are dropped; an `error` event throws. */
export async function* parseFclingEvents(
  chunks: AsyncIterable<Uint8Array>
): AsyncGenerator<FclingEvent, void, undefined> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
    let end = buffer.indexOf("\n\n");
    while (end >= 0) {
      const event = parseEventBlock(buffer.slice(0, end));
      buffer = buffer.slice(end + 2);
      if (event) yield event;
      end = buffer.indexOf("\n\n");
    }
  }
}

export interface FabricEventHandlers {
  onOpen?(): void;
  onEvent(event: FclingEvent): void;
  /** The stream ended: by the engine, or with an error. Not called after closing it. */
  onClose?(error?: Error): void;
}

/** How the Fabric view reaches a lab's engine, whichever host it runs in. */
export interface FabricClient {
  engineStatus(): Promise<FclingEngineStatus>;
  /** Starts the engine, or finds it running; pulling its image can take a while. */
  startEngine(options?: FclingEngineStartOptions): Promise<FclingEngineStatus>;
  /** Stops the engine and keeps its history. */
  stopEngine(): Promise<void>;
  /** The answer of the engine's API; rejects with a {@link FabricApiError}. */
  api<T = unknown>(request: FclingApiRequest): Promise<T>;
  /** Follows the engine's events, after this change if given. Returns how to stop. */
  openEvents(handlers: FabricEventHandlers, options?: { after?: number }): () => void;
}

export interface FabricWebviewInitialData {
  labName: string;
}

/** A request of the Fabric webview to the extension host, answered by `fabric:response`. */
export type FabricWebviewRequest =
  | { op: "engine-status" }
  | { op: "engine-start"; gnmiPort?: number }
  | { op: "engine-stop" }
  | { op: "api"; request: FclingApiRequest };

export type FabricOutgoingMessage =
  | ({ type: "fabric:request"; requestId: number } & FabricWebviewRequest)
  | { type: "fabric:events-start"; streamId: number; after?: number }
  | { type: "fabric:events-stop"; streamId: number };

export type FabricIncomingMessage =
  | { type: "fabric:response"; requestId: number; result?: unknown; error?: string; status?: number }
  | { type: "fabric:events-open"; streamId: number }
  | { type: "fabric:event"; streamId: number; event: FclingEvent }
  | { type: "fabric:events-end"; streamId: number; error?: string };
