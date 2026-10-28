/**
 * A Packetflix-compatible websocket server on this machine for the Wireshark
 * VNC containers of a c9s lab host, like clab-api-server's ticket endpoint:
 * each session gets a ticket bound to its lab and targets, which the
 * container's cshargextcap redeems (`PACKETFLIX_LINK`) for as long as the
 * session lives; every redemption runs one `containerlab -r c9s capture`.
 * Revoking the ticket ends its running captures (close 1008) and refuses
 * new ones (404 before the upgrade).
 */
import { randomBytes } from "node:crypto";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";

import WebSocket, { WebSocketServer } from "ws";

import type { CaptureNodeTarget } from "../capture.ts";

/** Opens the capture of the granted targets; ends when `signal` aborts. */
export type OpenGrantedCapture = (
  targets: CaptureNodeTarget[],
  signal: AbortSignal
) => Promise<AsyncIterable<Uint8Array>>;

export interface PacketflixGrant {
  labName: string;
  targets: CaptureNodeTarget[];
  open: OpenGrantedCapture;
}

/** Where a container finds the server: the URL host, and how it must be run to resolve it. */
export interface PacketflixListenAddress {
  /** The address the server binds, e.g. the Docker bridge gateway. */
  bind: string;
  /** The host in the `packetflix:` URL. */
  urlHost: string;
}

interface Ticket {
  grant: PacketflixGrant;
  /** Aborts on revoke; every running capture of the ticket listens to it. */
  revoked: AbortController;
}

const TICKET_PATH = "/packetflix/";
/** cshargextcap target type, written into the capture's section comment. */
const PACKETFLIX_TARGET_TYPE = "c9s-lab";
const CLOSE_NORMAL = 1000;
const CLOSE_POLICY = 1008;
const CLOSE_ERROR = 1011;
/** A send backlog above this waits for the socket to drain. */
const MAX_BUFFERED = 4 * 1024 * 1024;

function targetName(target: CaptureNodeTarget): string {
  return `${target.node}:${target.interface}`;
}

/**
 * Splits a `/`-joined list of target names into granted names. Interface
 * names may contain `/` themselves (`sros:1/1/3`), so the split follows them.
 */
export function splitGrantedNames(joined: string, granted: ReadonlySet<string>): string[] | undefined {
  const failed = new Set<number>();
  const split = (start: number): string[] | undefined => {
    if (failed.has(start)) return undefined;
    for (let end = start + 1; end <= joined.length; end++) {
      if (end < joined.length && joined[end] !== "/") continue;
      const name = joined.slice(start, end);
      if (!granted.has(name)) continue;
      if (end === joined.length) return [name];
      const rest = split(end + 1);
      if (rest) return [name, ...rest];
    }
    failed.add(start);
    return undefined;
  };
  return split(0);
}

/**
 * The targets a cshargextcap request captures: the `nif` names (also the
 * `Clustershark-Nif` header), or all granted ones. Every interface the
 * request names, in `nif` or in the `container` parameter, must be granted.
 */
export function selectGrantedTargets(
  url: URL,
  headers: http.IncomingHttpHeaders,
  granted: readonly CaptureNodeTarget[]
): CaptureNodeTarget[] | undefined {
  const names = new Set(granted.map(targetName));
  const header = (name: string) => {
    const value = headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const container = url.searchParams.get("container") || header("clustershark-container") || "";
  if (container.trim()) {
    try {
      const parsed = JSON.parse(container) as { "network-interfaces"?: unknown };
      const named = parsed["network-interfaces"];
      if (Array.isArray(named) && !named.every((name) => typeof name === "string" && names.has(name))) {
        return undefined;
      }
    } catch {
      return undefined;
    }
  }
  const nif = url.searchParams.get("nif") || header("clustershark-nif") || "";
  if (!nif || nif === "all") return [...granted];
  const picked = splitGrantedNames(nif, names);
  return picked ? granted.filter((target) => picked.includes(targetName(target))) : undefined;
}

/** `packetflix:ws://host:port/packetflix/<ticket>?container=…`, as clab-api-server builds it. */
function packetflixTicketUri(
  host: string,
  port: number,
  ticket: string,
  labName: string,
  targets: readonly CaptureNodeTarget[]
): string {
  const container = {
    name: labName,
    type: PACKETFLIX_TARGET_TYPE,
    "network-interfaces": targets.map(targetName)
  };
  const formatted = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return (
    `packetflix:ws://${formatted}:${port}${TICKET_PATH}${encodeURIComponent(ticket)}` +
    `?container=${encodeURIComponent(JSON.stringify(container))}`
  );
}

/** The ticket of a request path: `/packetflix/<ticket>`, with `/capture` or `/discover/mobyshark` after it. */
function ticketPath(pathname: string): { ticket: string; rest: string } | undefined {
  if (!pathname.startsWith(TICKET_PATH)) return undefined;
  const [ticket = "", ...rest] = pathname.slice(TICKET_PATH.length).split("/");
  return ticket ? { ticket: decodeURIComponent(ticket), rest: rest.join("/") } : undefined;
}

function refuse(socket: Socket, status: number, message: string): void {
  const body = JSON.stringify({ error: message });
  socket.end(
    `HTTP/1.1 ${status} ${http.STATUS_CODES[status] ?? ""}\r\nContent-Type: application/json\r\n` +
      `Content-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
  );
}

function closeReason(reason: string): string {
  const bytes = Buffer.from(reason);
  if (bytes.byteLength <= 123) return reason;
  return bytes.subarray(0, 123).toString("utf8").replace(/�$/, "");
}

/**
 * Serves capture tickets to Wireshark VNC containers. It listens while it
 * has tickets, on the address `listenAddress` picks when it starts.
 */
export class PacketflixTicketServer {
  private readonly tickets = new Map<string, Ticket>();
  private server: http.Server | undefined;
  private starting: Promise<{ port: number; urlHost: string }> | undefined;
  private readonly sockets = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  private readonly listenAddress: () => Promise<PacketflixListenAddress>;

  constructor(listenAddress: () => Promise<PacketflixListenAddress>) {
    this.listenAddress = listenAddress;
  }

  /** A session ticket for the grant; the `packetflix:` URL a container redeems it with. */
  async mint(grant: PacketflixGrant): Promise<{ ticket: string; packetflixUri: string }> {
    const ticket = randomBytes(32).toString("base64url");
    this.tickets.set(ticket, { grant, revoked: new AbortController() });
    try {
      const { port, urlHost } = await this.start();
      return { ticket, packetflixUri: packetflixTicketUri(urlHost, port, ticket, grant.labName, grant.targets) };
    } catch (error) {
      this.revoke(ticket);
      throw error;
    }
  }

  /** Ends the ticket's captures and refuses it from now on. The server stops with its last ticket. */
  revoke(ticket: string): void {
    const entry = this.tickets.get(ticket);
    if (!entry) return;
    this.tickets.delete(ticket);
    entry.revoked.abort();
    if (this.tickets.size === 0) this.stop();
  }

  close(): void {
    for (const ticket of this.tickets.keys()) this.revoke(ticket);
    this.stop();
  }

  private stop(): void {
    const server = this.server;
    this.server = undefined;
    this.starting = undefined;
    server?.close();
    server?.closeAllConnections();
  }

  private start(): Promise<{ port: number; urlHost: string }> {
    this.starting ??= this.listen().catch((error: unknown) => {
      this.starting = undefined;
      throw error;
    });
    return this.starting;
  }

  private async listen(): Promise<{ port: number; urlHost: string }> {
    const address = await this.listenAddress();
    const server = http.createServer((request, response) => this.handleHttp(request, response));
    server.on("upgrade", (request: http.IncomingMessage, socket: Socket, head: Buffer) =>
      this.handleUpgrade(request, socket, head)
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, address.bind, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
    return { port: (server.address() as AddressInfo).port, urlHost: address.urlHost };
  }

  /** cshargextcap's target discovery before a capture: the ticket names the targets, so none. */
  private handleHttp(request: http.IncomingMessage, response: http.ServerResponse): void {
    const url = new URL(request.url ?? "/", "http://packetflix");
    const parsed = ticketPath(url.pathname);
    if (request.method === "GET" && parsed?.rest === "discover/mobyshark") {
      response.writeHead(200, { "Content-Type": "application/json" }).end('{"containers":[]}');
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" }).end('{"error":"not found"}');
  }

  private handleUpgrade(request: http.IncomingMessage, socket: Socket, head: Buffer): void {
    const url = new URL(request.url ?? "/", "http://packetflix");
    const parsed = ticketPath(url.pathname);
    const entry = parsed && (parsed.rest === "" || parsed.rest === "capture") ? this.tickets.get(parsed.ticket) : undefined;
    if (!entry) {
      refuse(socket, 404, "capture ticket unknown or revoked");
      return;
    }
    const targets = selectGrantedTargets(url, request.headers, entry.grant.targets);
    if (!targets || targets.length === 0) {
      refuse(socket, 403, "the capture names interfaces the ticket does not grant");
      return;
    }
    this.sockets.handleUpgrade(request, socket, head, (ws) => {
      void this.serve(ws, entry, targets);
    });
  }

  /** Streams one capture into the socket, one binary message per pcapng block, like Packetflix. */
  private async serve(ws: WebSocket, entry: Ticket, targets: CaptureNodeTarget[]): Promise<void> {
    const capture = new AbortController();
    const stopCapture = () => capture.abort();
    entry.revoked.signal.addEventListener("abort", stopCapture, { once: true });
    ws.once("close", stopCapture);
    // Data from the client is not part of the protocol.
    ws.on("message", () => {});
    ws.on("error", stopCapture);
    let code = CLOSE_NORMAL;
    let reason = "capture ended";
    try {
      const stream = await entry.grant.open(targets, capture.signal);
      for await (const chunk of stream) {
        if (ws.readyState !== WebSocket.OPEN) break;
        await new Promise<void>((resolve) => ws.send(chunk, { binary: true }, () => resolve()));
        while (ws.bufferedAmount > MAX_BUFFERED && ws.readyState === WebSocket.OPEN) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    } catch (error) {
      code = CLOSE_ERROR;
      reason = closeReason(error instanceof Error ? error.message : String(error));
    } finally {
      entry.revoked.signal.removeEventListener("abort", stopCapture);
      capture.abort();
    }
    if (entry.revoked.signal.aborted) {
      code = CLOSE_POLICY;
      reason = "capture ticket revoked";
    }
    if (ws.readyState === WebSocket.OPEN) ws.close(code, reason);
  }
}
