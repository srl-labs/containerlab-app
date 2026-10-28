import net from "node:net";
import { duplexPair, PassThrough, Writable } from "node:stream";

import type { InspectContainerInfo, LabStatsSample, NodeBrowserPort, NodeStats } from "../../contract/dto.ts";
import { LabBackendError } from "../../contract/errors.ts";
import type { NodeAccess } from "../nodeAccess.ts";
import type { ResolvedLocalOptions } from "../options.ts";
import { containerlabCommand, runChecked, spawnLines } from "../process.ts";
import type { SshEndpoint, TerminalProcess, TerminalTarget } from "../terminals.ts";
import { PORT_DESCRIPTIONS } from "../tools.ts";
import { inspectC9sLabs, type C9sContainerRecord } from "./inspect.ts";
import type { KubeClient, KubeStream } from "./kubeClient.ts";

/** How often the stats stream looks for nodes that started or stopped. */
const NODE_REFRESH_MS = 10_000;

/** A Kubernetes CPU quantity in cores: `250m`, `1`, `12345n`, `3u`. */
export function cpuCores(quantity: string): number {
  const match = /^([0-9.]+)([numk]?)$/.exec(quantity.trim());
  if (!match) return 0;
  const value = Number(match[1]);
  const scale: Record<string, number> = { n: 1e-9, u: 1e-6, m: 1e-3, "": 1, k: 1e3 };
  return value * (scale[match[2]] ?? 1);
}

/** A Kubernetes memory quantity in bytes: `128Mi`, `1Gi`, `1000k`, `12345`. */
export function memoryBytes(quantity: string): number {
  const match = /^([0-9.]+)(Ki|Mi|Gi|Ti|k|M|G|T)?$/.exec(quantity.trim());
  if (!match) return 0;
  const scale: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    k: 1e3,
    M: 1e6,
    G: 1e9,
    T: 1e12
  };
  return Math.round(Number(match[1]) * (match[2] ? scale[match[2]] : 1));
}

function record(container: InspectContainerInfo): C9sContainerRecord {
  return container as unknown as C9sContainerRecord;
}

/** Where a terminal or port-forward goes; containerlab must have reported it. */
function location(target: { nodeName?: string; namespace?: string; pod?: string; container?: string }) {
  if (!target.namespace || !target.pod || !target.container) {
    throw new LabBackendError(
      `containerlab did not report the pod of node "${target.nodeName ?? ""}". Update containerlab to a release with c9s node access.`,
      502
    );
  }
  return { namespace: target.namespace, pod: target.pod, container: target.container };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** A stdout for a TTY exec that client-node asks for its size, and resizes on `resize`. */
class TerminalOutput extends Writable {
  columns: number;
  rows: number;
  private readonly onData: (chunk: Buffer) => void;

  constructor(size: { cols: number; rows: number }, onData: (chunk: Buffer) => void) {
    super();
    this.columns = size.cols;
    this.rows = size.rows;
    this.onData = onData;
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void): void {
    this.onData(Buffer.from(chunk));
    callback();
  }

  resize(cols: number, rows: number): void {
    this.columns = cols;
    this.rows = rows;
    this.emit("resize");
  }
}

/**
 * Nodes of a c9s lab: containerlab lists them and their pods, Kubernetes
 * carries the bytes. Terminals exec in the device container that
 * `containerlab inspect` names, SSH and browser ports go through
 * port-forwards (or the node's load balancer), logs come from
 * `containerlab logs` and stats from metrics.k8s.io.
 */
export class KubeNodeAccess implements NodeAccess {
  private readonly options: ResolvedLocalOptions;
  private readonly client: () => KubeClient;
  /** Open streams: exec sessions and SSH port-forwards. */
  private readonly streams = new Set<KubeStream>();
  /** Local listeners that forward browser ports, by `<namespace>/<pod>/<port>`. */
  private readonly listeners = new Map<string, Promise<net.Server>>();
  /** Connections to those listeners, ended on dispose. */
  private readonly sockets = new Set<net.Socket>();
  private metrics: Promise<boolean> | undefined;

  constructor(options: ResolvedLocalOptions, client: () => KubeClient) {
    this.options = options;
    this.client = client;
  }

  inspectLabs(labName?: string) {
    return inspectC9sLabs(this.options, labName);
  }

  async topologyNodeName(container: InspectContainerInfo): Promise<string> {
    return record(container).nodeName || container.name;
  }

  /** `containerlab logs` for one node; `all` leaves out `--tail`. */
  private logArgs(container: InspectContainerInfo, tail: string, follow: boolean): string[] {
    const node = record(container);
    return [
      "logs",
      "-r",
      "c9s",
      "--name",
      node.lab_name,
      "-n",
      node.nodeName,
      ...(tail === "all" ? [] : ["--tail", tail]),
      "--timestamps",
      ...(follow ? ["--follow"] : [])
    ];
  }

  async nodeLogs(container: InspectContainerInfo, tail: string) {
    const [file, args] = containerlabCommand(this.options, this.logArgs(container, tail, false));
    const result = await runChecked(file, args, { env: this.options.env, timeoutMs: 60_000 });
    return { containerName: container.name, logs: result.stdout };
  }

  async streamNodeLogs(container: InspectContainerInfo, options: { tail: string; signal: AbortSignal }) {
    const [file, args] = containerlabCommand(
      this.options,
      this.logArgs(container, options.tail, true)
    );
    const command = await spawnLines(file, args, { env: this.options.env, signal: options.signal });
    async function* lines() {
      try {
        for await (const output of command.lines) yield output;
      } finally {
        command.kill();
      }
    }
    return lines();
  }

  async exec(
    target: TerminalTarget,
    command: string[],
    size: { cols: number; rows: number },
    events: { output(data: Buffer): void; exit(exitCode: number | null, error?: string): void }
  ): Promise<TerminalProcess> {
    const where = location(target);
    const stdin = new PassThrough();
    const stdout = new TerminalOutput(size, (chunk) => events.output(chunk));
    let ended = false;
    let stream: KubeStream | undefined;
    const finish = (exitCode: number | null, error?: string) => {
      if (ended) return;
      ended = true;
      if (stream) this.streams.delete(stream);
      events.exit(exitCode, error);
    };
    stream = await this.client().exec({
      ...where,
      command,
      stdout,
      stderr: null,
      stdin,
      tty: true,
      onExit: finish
    });
    this.streams.add(stream);
    const opened = stream;
    return {
      write: (data) => {
        if (!stdin.writableEnded) stdin.write(data);
      },
      resize: (cols, rows) => stdout.resize(cols, rows),
      kill: () => {
        // Ending input makes most shells exit; closing the stream ends the exec.
        // A session is killed again when its lab host shuts down.
        if (!stdin.writableEnded) stdin.end("\x04");
        opened.close();
        this.streams.delete(opened);
      }
    };
  }

  async sshEndpoint(target: TerminalTarget): Promise<SshEndpoint> {
    const exposed = target.exposedPorts?.find((entry) => entry.destinationPort === 22 && entry.protocol === "TCP");
    if (target.loadBalancerAddress && exposed) {
      return { host: target.loadBalancerAddress, port: exposed.exposePort };
    }
    const where = location(target);
    const [local, remote] = duplexPair();
    const stream = await this.client().portForward({
      namespace: where.namespace,
      pod: where.pod,
      port: 22,
      output: remote,
      input: remote
    });
    this.streams.add(stream);
    local.once("close", () => {
      stream.close();
      this.streams.delete(stream);
    });
    return { host: target.nodeName, sock: local };
  }

  /** A listener on this machine that forwards each connection to a pod port. */
  private listen(namespace: string, pod: string, port: number): Promise<net.Server> {
    const key = `${namespace}/${pod}/${port}`;
    let listener = this.listeners.get(key);
    if (!listener) {
      listener = new Promise<net.Server>((resolve, reject) => {
        const server = net.createServer((socket) => {
          this.sockets.add(socket);
          socket.once("close", () => this.sockets.delete(socket));
          this.client()
            .portForward({ namespace, pod, port, output: socket, input: socket })
            .then(
              (stream) => {
                this.streams.add(stream);
                socket.once("close", () => {
                  stream.close();
                  this.streams.delete(stream);
                });
              },
              () => socket.destroy()
            );
        });
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve(server));
      });
      listener.catch(() => this.listeners.delete(key));
      this.listeners.set(key, listener);
    }
    return listener;
  }

  async browserPorts(container: InspectContainerInfo): Promise<NodeBrowserPort[]> {
    const node = record(container);
    const tcp = (node.exposed_ports ?? []).filter((entry) => entry.protocol === "TCP");
    const ports: NodeBrowserPort[] = [];
    for (const entry of tcp) {
      const description = PORT_DESCRIPTIONS[entry.destinationPort];
      if (node.load_balancer_address) {
        ports.push({
          hostIp: node.load_balancer_address,
          hostPort: entry.exposePort,
          containerPort: entry.destinationPort,
          protocol: "tcp",
          ...(description ? { description } : {})
        });
        continue;
      }
      const where = location(node);
      const server = await this.listen(where.namespace, where.pod, entry.destinationPort);
      const address = server.address();
      if (address === null || typeof address === "string") continue;
      ports.push({
        hostIp: "127.0.0.1",
        hostPort: address.port,
        containerPort: entry.destinationPort,
        protocol: "tcp",
        ...(description ? { description } : {})
      });
    }
    return ports.sort((left, right) => left.containerPort - right.containerPort);
  }

  statsAvailable(): Promise<boolean> {
    // A kubeconfig that does not load or a cluster without metrics.k8s.io has no stats.
    this.metrics ??= Promise.resolve()
      .then(() => this.client().hasMetricsApi())
      .catch(() => false);
    return this.metrics;
  }

  async *labStats(labName: string, intervalSeconds: number, signal: AbortSignal): AsyncGenerator<LabStatsSample> {
    let nodes: C9sContainerRecord[] = [];
    let listedAt = Number.NEGATIVE_INFINITY;
    while (!signal.aborted) {
      if (Date.now() - listedAt >= NODE_REFRESH_MS) {
        nodes = ((await this.inspectLabs(labName))[labName] ?? []).map(record);
        listedAt = Date.now();
      }
      const namespaces = Array.from(new Set(nodes.map((node) => node.namespace).filter(Boolean)));
      const metrics = new Map<string, Map<string, { cpu: string; memory: string }>>();
      await Promise.all(
        namespaces.map(async (namespace) => {
          const pods = await this.client()
            .podMetrics(namespace)
            .catch(() => []);
          for (const pod of pods) {
            metrics.set(
              `${namespace}/${pod.pod}`,
              new Map(pod.containers.map((container) => [container.name, container]))
            );
          }
        })
      );
      const samples: NodeStats[] = [];
      for (const node of nodes) {
        const containers = metrics.get(`${node.namespace}/${node.pod}`);
        // The device container's usage; a pod that reports no such container is skipped.
        const usage = containers?.get(node.container);
        if (!usage) continue;
        samples.push({
          name: node.name,
          nodeName: node.nodeName,
          cpuPercent: Math.round(cpuCores(usage.cpu) * 1000) / 10,
          memoryBytes: memoryBytes(usage.memory)
        });
      }
      if (signal.aborted) return;
      yield { type: "stats", time: new Date().toISOString(), intervalSeconds, nodes: samples };
      await sleep(intervalSeconds * 1000, signal);
    }
  }

  async dispose(): Promise<void> {
    for (const stream of this.streams) stream.close();
    this.streams.clear();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const listeners = Array.from(this.listeners.values());
    this.listeners.clear();
    await Promise.all(
      listeners.map((listener) =>
        listener.then(
          (server) => new Promise<void>((resolve) => server.close(() => resolve())),
          () => undefined
        )
      )
    );
  }
}
