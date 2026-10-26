import * as vscode from "vscode";
import type {
  LabBackend,
  TerminalProtocol,
  TerminalStream
} from "@srl-labs/containerlab-lab-backend";

import { errorStatus } from "@srl-labs/containerlab-lab-backend";

import type { ClabContainerTreeNode } from "../treeView/common";

import { backendOf, connectionOf, isRemote } from "./labBackends";

const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 32;
/** Lines of a node's log shown before following it. */
const LOG_TAIL_LINES = "1000";
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10000];
/** About five minutes of attempts before a lost lab host gives up the terminal. */
const MAX_RECONNECTS = 35;
/** Resets the terminal before a lab host replays a session's output. */
const TERMINAL_RESET = "\x1bc";

/** The lab of a node on a lab host; the tree knows it from the host's records. */
async function labNameOf(
  backend: LabBackend,
  containerName: string,
  known?: string
): Promise<string> {
  if (known !== undefined && known !== "") return known;
  const labs = await backend.inspectAll();
  for (const [labName, containers] of Object.entries(labs)) {
    if (containers.some((container) => container.name === containerName)) return labName;
  }
  throw new Error(`Lab of ${containerName} not found.`);
}

/** Whether a node runs on a lab host, so its tools go through the host's API. */
export function isRemoteNode(node: unknown): boolean {
  return isRemote(node);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A VS Code terminal backed by a terminal session on the lab host: shell
 * and telnet run in the node's container, SSH starts on the lab host.
 */
class RemoteNodeTerminal implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number | void>();
  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;
  private readonly decoder = new TextDecoder();
  private stream: TerminalStream | undefined;
  private sessionId: string | undefined;
  private closed = false;
  private pendingSize: { cols: number; rows: number } | undefined;
  private size: { cols: number; rows: number } = { cols: DEFAULT_COLUMNS, rows: DEFAULT_ROWS };
  private resumable = false;
  private reconnects = 0;

  constructor(
    private readonly backend: LabBackend,
    private readonly labName: string,
    private readonly containerName: string,
    private readonly protocol: TerminalProtocol,
    private readonly options: { sshUsername?: string; telnetPort?: number }
  ) {}

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    this.size = {
      cols: initialDimensions?.columns ?? DEFAULT_COLUMNS,
      rows: initialDimensions?.rows ?? DEFAULT_ROWS
    };
    void this.start(this.size.cols, this.size.rows);
  }

  private async start(cols: number, rows: number): Promise<void> {
    this.writeEmitter.fire(
      `\x1b[2mConnecting to ${this.containerName} (${this.protocol})…\x1b[0m\r\n`
    );
    try {
      const session = await this.backend.createTerminal(this.labName, this.containerName, {
        protocol: this.protocol,
        cols,
        rows,
        ...this.options,
        // The terminal attaches again after a dropped connection.
        resumable: true
      });
      this.sessionId = session.sessionId;
      if (this.closed) {
        void this.backend.closeTerminal(session.sessionId).catch(() => {});
        return;
      }
      await this.attach(session.sessionId);
    } catch (error) {
      this.writeEmitter.fire(`\r\n\x1b[31mCannot open a terminal: ${messageOf(error)}\x1b[0m\r\n`);
      this.finish(1);
    }
  }

  /** Attaches to the session; a lab host that keeps sessions is attached again after a drop. */
  private async attach(sessionId: string): Promise<void> {
    const stream = await this.backend.attachTerminal(sessionId);
    this.stream = stream;
    let ended = false;
    let replayPending = false;
    stream.onMessage((message) => {
      if (message.type === "ready") {
        this.resumable ||= message.resumable === true;
        replayPending = message.replay === true;
        this.reconnects = 0;
        stream.send({ type: "resize", ...(this.pendingSize ?? this.size) });
        this.pendingSize = undefined;
      } else if (message.type === "output") {
        if (replayPending) {
          replayPending = false;
          this.writeEmitter.fire(TERMINAL_RESET);
        }
        const bytes = Buffer.from(message.data, "base64");
        this.writeEmitter.fire(this.decoder.decode(bytes, { stream: true }));
      } else if (message.type === "exit") {
        ended = true;
        if (message.error !== undefined && message.error !== "")
          this.writeEmitter.fire(`\r\n\x1b[31m${message.error}\x1b[0m\r\n`);
        this.finish(typeof message.exitCode === "number" ? message.exitCode : undefined);
      }
    });
    stream.onClose((reason, { takenOver }) => {
      if (this.closed || ended) return;
      if (takenOver) {
        this.writeEmitter.fire(`\r\n\x1b[2mThis terminal was opened somewhere else.\x1b[0m\r\n`);
        this.finish();
        return;
      }
      if (!this.resumable) {
        this.finish();
        return;
      }
      void this.reconnect(sessionId, reason);
    });
  }

  private async reconnect(sessionId: string, reason: string): Promise<void> {
    if (this.reconnects >= MAX_RECONNECTS) {
      this.writeEmitter.fire(`\r\n\x1b[31mThe lab host did not come back: ${reason}\x1b[0m\r\n`);
      this.finish();
      return;
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnects, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnects += 1;
    this.writeEmitter.fire(`\r\n\x1b[2m${reason}. Reconnecting…\x1b[0m\r\n`);
    await new Promise((resolve) => setTimeout(resolve, delay));
    if (this.closed) return;
    try {
      const info = await this.backend.getTerminal(sessionId);
      if (info.state === "closed") {
        this.writeEmitter.fire(`\r\n\x1b[31mThe session ended on the lab host.\x1b[0m\r\n`);
        this.finish();
        return;
      }
      await this.attach(sessionId);
    } catch (error) {
      if (errorStatus(error) === 404 || errorStatus(error) === 410) {
        this.writeEmitter.fire(`\r\n\x1b[31mThe session expired on the lab host.\x1b[0m\r\n`);
        this.finish();
        return;
      }
      void this.reconnect(sessionId, messageOf(error));
    }
  }

  private finish(exitCode?: number): void {
    if (this.closed) return;
    this.closed = true;
    this.stream?.close();
    this.closeEmitter.fire(exitCode);
  }

  handleInput(data: string): void {
    this.stream?.send({ type: "input", data });
  }

  setDimensions(dimensions: vscode.TerminalDimensions): void {
    const size = { cols: dimensions.columns, rows: dimensions.rows };
    this.size = size;
    if (this.stream) this.stream.send({ type: "resize", ...size });
    else this.pendingSize = size;
  }

  close(): void {
    const wasClosed = this.closed;
    this.closed = true;
    if (this.stream) {
      this.stream.send({ type: "close" });
      this.stream.close();
    }
    if (this.sessionId !== undefined && !wasClosed) {
      void this.backend.closeTerminal(this.sessionId).catch(() => {});
    }
  }
}

/** Opens a node terminal through the lab host, or focuses the one already open. */
export async function openRemoteTerminal(
  node: ClabContainerTreeNode,
  protocol: TerminalProtocol,
  title: string,
  options: { sshUsername?: string; telnetPort?: number } = {}
): Promise<void> {
  const existing = vscode.window.terminals.find(
    (terminal) => terminal.name === title && terminal.exitStatus === undefined
  );
  if (existing) {
    existing.show();
    return;
  }
  try {
    const backend = backendOf(node);
    const labName = await labNameOf(backend, node.name, node.labName);
    const terminal = vscode.window.createTerminal({
      name: title,
      pty: new RemoteNodeTerminal(backend, labName, node.name, protocol, options),
      iconPath: new vscode.ThemeIcon(protocol === "ssh" ? "remote" : "terminal")
    });
    terminal.show();
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Cannot open a terminal on ${node.name}: ${messageOf(error)}`
    );
  }
}

/** A read-only VS Code terminal that follows a node's log on the lab host. */
class RemoteNodeLogs implements vscode.Pseudoterminal {
  private readonly writeEmitter = new vscode.EventEmitter<string>();
  private readonly closeEmitter = new vscode.EventEmitter<number | void>();
  readonly onDidWrite = this.writeEmitter.event;
  readonly onDidClose = this.closeEmitter.event;
  private readonly controller = new AbortController();

  constructor(
    private readonly backend: LabBackend,
    private readonly labName: string,
    private readonly containerName: string
  ) {}

  open(): void {
    void this.follow();
  }

  private async follow(): Promise<void> {
    const { signal } = this.controller;
    try {
      const lines = await this.backend.streamNodeLogs(this.labName, this.containerName, {
        tail: LOG_TAIL_LINES,
        signal
      });
      for await (const { line, stream } of lines) {
        this.writeEmitter.fire(stream === "stderr" ? `\x1b[33m${line}\x1b[0m\r\n` : `${line}\r\n`);
      }
      if (!signal.aborted) this.writeEmitter.fire(`\r\n\x1b[2mThe log stream ended.\x1b[0m\r\n`);
    } catch (error) {
      if (!signal.aborted) {
        this.writeEmitter.fire(
          `\r\n\x1b[31mCannot follow the logs: ${messageOf(error)}\x1b[0m\r\n`
        );
      }
    }
  }

  handleInput(): void {}

  close(): void {
    this.controller.abort();
  }
}

/** Follows the container log of a node on the lab host in a terminal. */
export async function showRemoteLogs(node: ClabContainerTreeNode): Promise<void> {
  const title = `Logs - ${node.name}`;
  const existing = vscode.window.terminals.find(
    (terminal) => terminal.name === title && terminal.exitStatus === undefined
  );
  if (existing) {
    existing.show();
    return;
  }
  try {
    const backend = backendOf(node);
    const labName = await labNameOf(backend, node.name, node.labName);
    const terminal = vscode.window.createTerminal({
      name: title,
      pty: new RemoteNodeLogs(backend, labName, node.name),
      iconPath: new vscode.ThemeIcon("output")
    });
    terminal.show();
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Cannot show the logs of ${node.name}: ${messageOf(error)}`
    );
  }
}

export interface RemotePortMapping {
  hostPort: string;
  containerPort: string;
  protocol: string;
  description: string;
}

/** Published ports of a node on the lab host. */
export async function remoteBrowserPorts(
  node: ClabContainerTreeNode
): Promise<RemotePortMapping[]> {
  const backend = backendOf(node);
  const labName = await labNameOf(backend, node.name, node.labName);
  const { ports } = await backend.nodeBrowserPorts(labName, node.name);
  return ports.map((port) => ({
    hostPort: String(port.hostPort),
    containerPort: String(port.containerPort),
    protocol: port.protocol ?? "tcp",
    description: port.description ?? ""
  }));
}

/** The host name of a node's lab host, for links to ports it publishes. */
export function remoteHostname(node: unknown): string | undefined {
  const url = connectionOf(node).url;
  if (url === undefined) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export { labNameOf as remoteLabNameOf };
