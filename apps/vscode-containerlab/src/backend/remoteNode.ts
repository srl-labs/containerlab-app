import * as vscode from "vscode";
import type {
  LabBackend,
  TerminalProtocol,
  TerminalStream
} from "@srl-labs/containerlab-lab-backend";

import type { ClabContainerTreeNode } from "../treeView/common";

import { backendOf, connectionOf, isRemote } from "./labBackends";

const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 32;

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

  constructor(
    private readonly backend: LabBackend,
    private readonly labName: string,
    private readonly containerName: string,
    private readonly protocol: TerminalProtocol,
    private readonly options: { sshUsername?: string; telnetPort?: number }
  ) {}

  open(initialDimensions: vscode.TerminalDimensions | undefined): void {
    void this.start(
      initialDimensions?.columns ?? DEFAULT_COLUMNS,
      initialDimensions?.rows ?? DEFAULT_ROWS
    );
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
        ...this.options
      });
      this.sessionId = session.sessionId;
      if (this.closed) {
        void this.backend.closeTerminal(session.sessionId).catch(() => {});
        return;
      }
      const stream = await this.backend.attachTerminal(session.sessionId);
      this.stream = stream;
      stream.onMessage((message) => {
        if (message.type === "output") {
          const bytes = Buffer.from(message.data, "base64");
          this.writeEmitter.fire(this.decoder.decode(bytes, { stream: true }));
        } else if (message.type === "exit") {
          if (message.error !== undefined && message.error !== "")
            this.writeEmitter.fire(`\r\n\x1b[31m${message.error}\x1b[0m\r\n`);
          this.finish(typeof message.exitCode === "number" ? message.exitCode : undefined);
        }
      });
      stream.onClose(() => this.finish());
      if (this.pendingSize) {
        stream.send({ type: "resize", ...this.pendingSize });
        this.pendingSize = undefined;
      }
    } catch (error) {
      this.writeEmitter.fire(`\r\n\x1b[31mCannot open a terminal: ${messageOf(error)}\x1b[0m\r\n`);
      this.finish(1);
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

/** Shows the container log of a node on the lab host in an editor. */
export async function showRemoteLogs(node: ClabContainerTreeNode): Promise<void> {
  try {
    const backend = backendOf(node);
    const labName = await labNameOf(backend, node.name, node.labName);
    const { logs } = await backend.nodeLogs(labName, node.name, { tail: "all" });
    const document = await vscode.workspace.openTextDocument({ content: logs, language: "log" });
    await vscode.window.showTextDocument(document, { preview: false });
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
