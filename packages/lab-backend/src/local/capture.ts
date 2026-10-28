import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type Docker from "dockerode";
import WebSocket from "ws";

import type { WiresharkVncRequest, WiresharkVncResponse, WiresharkVncSocket } from "../contract/backend.ts";
import type {
  CaptureCloseAllResponse,
  CapturePacketflixResponse,
  CapturePacketflixURI,
  CaptureTarget,
  CaptureWiresharkVncCreateResponse,
  CaptureWiresharkVncReadyResponse,
  CaptureWiresharkVncSession,
  EdgeSharkStatusResponse
} from "../contract/dto.ts";
import { LabBackendError } from "../contract/errors.ts";
import type { CaptureNodeTarget } from "../capture.ts";
import { wrapWebSocket } from "../webSocket.ts";
import { containerRuntimeCli, type ResolvedLocalOptions } from "./options.ts";
import { PacketflixTicketServer, type OpenGrantedCapture, type PacketflixListenAddress } from "./packetflixServer.ts";
import { runChecked, runCommand } from "./process.ts";

const EDGESHARK_COMPOSE_URL =
  "https://github.com/siemens/edgeshark/raw/main/deployments/wget/docker-compose.yaml";
const VNC_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const VNC_PORT = 5800;
/** How long a container runtime probe holds. */
const RUNTIME_PROBE_TTL_MS = 30_000;

/** Why a c9s host on this machine offers no Wireshark VNC. */
export const WIRESHARK_VNC_NEEDS_DOCKER = "Wireshark in the browser needs Docker on this computer";

/** A Packetflix capture of one network namespace. */
interface CaptureGroup {
  containerName: string;
  interfaceNames: string[];
  /** Host-side interfaces of stitched links are captured in the host namespace. */
  hostNamespace: boolean;
}

/**
 * Groups capture targets per container. Host-side link ends (`clab-…`) are
 * grouped into one host-namespace capture, like clab-api-server does.
 */
export function groupCaptureTargets(targets: CaptureTarget[]): CaptureGroup[] {
  const groups = new Map<string, CaptureGroup>();
  for (const target of targets) {
    const hostNamespace = !target.nodeNamespace && target.interfaceName.startsWith("clab-");
    const key = hostNamespace ? "\0host" : target.containerName;
    const group = groups.get(key) ?? {
      containerName: target.containerName,
      interfaceNames: [],
      hostNamespace
    };
    if (!group.interfaceNames.includes(target.interfaceName)) group.interfaceNames.push(target.interfaceName);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function hostNetworkNamespaceInode(): Promise<number | undefined> {
  try {
    const link = await fs.readlink("/proc/self/ns/net");
    const inode = /\[(\d+)\]/.exec(link)?.[1];
    return inode ? Number(inode) : undefined;
  } catch {
    return undefined;
  }
}

function formatHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/** `packetflix:ws://host:port/capture?container=…&nif=…` as clab-api-server builds it. */
export function packetflixUri(
  host: string,
  port: number,
  group: CaptureGroup,
  hostNamespaceInode?: number
): string {
  const container = group.hostNamespace
    ? { netns: hostNamespaceInode ?? 0, "network-interfaces": group.interfaceNames }
    : { name: group.containerName, "network-interfaces": group.interfaceNames, type: "docker" };
  return (
    `packetflix:ws://${formatHost(host)}:${port}/capture` +
    `?container=${encodeURIComponent(JSON.stringify(container))}` +
    `&nif=${encodeURIComponent(group.interfaceNames.join("/"))}`
  );
}

/**
 * Edgeshark's compose file, adjusted the way the VS Code extension always did:
 * Packetflix finds gostwire by its bare service name, which Podman's DNS can
 * resolve too, and extra environment variables go into both services.
 */
export function prepareEdgesharkCompose(compose: string, extraEnv: string[]): string {
  const lines = compose
    .replace(/--discovery-service=gostwire[.][^"]*/g, "--discovery-service=gostwire")
    .split("\n");
  if (extraEnv.length === 0) return lines.join("\n");
  const result: string[] = [];
  let service = "";
  for (const line of lines) {
    const serviceMatch = /^ {4}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (serviceMatch) service = serviceMatch[1];
    result.push(line);
    if ((service === "gostwire" || service === "edgeshark") && /^ {8}pull_policy:.*always/.test(line)) {
      result.push("        environment:", ...extraEnv.map((entry) => `          - ${entry}`));
    }
  }
  return result.join("\n");
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("No free port"));
      });
    });
  });
}

interface VncSession extends CaptureWiresharkVncSession {
  containerId: string;
  port: number;
  /** The container runtime that runs the container. */
  runtime: string;
  /** The capture ticket the container redeems (c9s); revoked when the session closes. */
  ticket?: string;
}

/** The Wireshark VNC container of one session. */
interface VncContainerSpec {
  labName: string;
  containerName: string;
  interfaceNames: string[];
  packetflixLink: string;
  theme?: string;
  runArgs: string[];
  labDirectory?: string;
}

/** The gateway of a container runtime's default network, e.g. `172.17.0.1` for Docker's bridge. */
async function defaultNetworkGateway(runtime: string): Promise<string | undefined> {
  const network = runtime === "podman" ? "podman" : "bridge";
  const result = await runCommand(
    runtime,
    ["network", "inspect", network, "--format", "{{range .IPAM.Config}}{{.Gateway}} {{end}}"],
    { timeoutMs: 10_000 }
  ).catch(() => undefined);
  if (result?.code !== 0) return undefined;
  return result.stdout.split(/\s+/).find((address) => net.isIPv4(address));
}

/** Whether this machine has the address, so a server can bind it. */
function canBind(address: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(0, address, () => server.close(() => resolve(true)));
  });
}

/**
 * Where the Packetflix server of a c9s host listens so that Wireshark VNC
 * containers reach it: the gateway of the runtime's default network when
 * this machine has it (Docker and rootful Podman on Linux), else loopback,
 * which Docker Desktop forwards `host.docker.internal` to.
 */
async function packetflixListenAddress(runtime: string): Promise<PacketflixListenAddress> {
  const gateway = await defaultNetworkGateway(runtime);
  if (gateway && (await canBind(gateway))) return { bind: gateway, urlHost: gateway };
  return { bind: "127.0.0.1", urlHost: runtime === "podman" ? "host.containers.internal" : "host.docker.internal" };
}

function publicVncSession(session: VncSession): CaptureWiresharkVncSession {
  const { containerId: _id, port: _port, runtime: _runtime, ticket: _ticket, ...publicSession } = session;
  return publicSession;
}

/** Edgeshark, Packetflix links and Wireshark VNC containers on this machine. */
export class LocalCapture {
  private readonly vncSessions = new Map<string, VncSession>();
  private readonly packetflixServer: PacketflixTicketServer;
  private runtimeProbe: { at: number; runtime: Promise<string | undefined> } | undefined;

  private readonly options: ResolvedLocalOptions;
  private readonly docker: () => Docker;

  constructor(options: ResolvedLocalOptions, docker: () => Docker) {
    this.options = options;
    this.docker = docker;
    this.packetflixServer = new PacketflixTicketServer(async () => {
      const runtime = await this.vncRuntime();
      if (!runtime) throw new LabBackendError(WIRESHARK_VNC_NEEDS_DOCKER, 501);
      return packetflixListenAddress(runtime);
    });
  }

  /**
   * The container runtime that runs Wireshark VNC containers: the lab
   * runtime itself, or for c9s Docker or Podman on this machine, whichever
   * answers first. Undefined without one.
   */
  vncRuntime(): Promise<string | undefined> {
    if (this.options.runtime !== "c9s") return Promise.resolve(this.options.runtime);
    const now = Date.now();
    if (!this.runtimeProbe || now - this.runtimeProbe.at > RUNTIME_PROBE_TTL_MS) {
      this.runtimeProbe = {
        at: now,
        runtime: (async () => {
          for (const runtime of ["docker", "podman"]) {
            const result = await runCommand(runtime, ["version", "--format", "{{.Server.Version}}"], {
              env: this.options.env,
              timeoutMs: 5000
            }).catch(() => undefined);
            if (result?.code === 0 && result.stdout.trim()) return runtime;
          }
          return undefined;
        })()
      };
    }
    return this.runtimeProbe.runtime;
  }

  async edgesharkStatus(): Promise<EdgeSharkStatusResponse> {
    const status: EdgeSharkStatusResponse = {
      running: false,
      packetflixPort: this.options.packetflixPort,
      runtime: this.options.runtime
    };
    try {
      const response = await fetch(`http://127.0.0.1:${this.options.packetflixPort}/version`, {
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        const version = (await response.text()).trim();
        return { ...status, running: true, ...(version ? { version } : {}) };
      }
    } catch {
      // Not answering on HTTP; check the containers.
    }
    try {
      const containers = await this.docker().listContainers({ filters: { name: ["edgeshark"] } });
      const running = containers.some((container) =>
        /packetflix|edgeshark-edgeshark|edgeshark_edgeshark/.test(
          `${container.Names.join(" ")} ${container.Image}`
        )
      );
      return { ...status, running };
    } catch {
      return status;
    }
  }

  private async composeFile(): Promise<string> {
    const response = await fetch(EDGESHARK_COMPOSE_URL, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      throw new LabBackendError(`Failed to download the Edgeshark compose file: ${response.status}`, 502);
    }
    const compose = prepareEdgesharkCompose(
      await response.text(),
      this.options.edgesharkExtraEnv.filter((entry) => entry.includes("="))
    );
    const file = path.join(os.tmpdir(), `edgeshark-${randomBytes(6).toString("hex")}.yaml`);
    await fs.writeFile(file, compose, { mode: 0o600 });
    return file;
  }

  private async compose(action: "up" | "down"): Promise<void> {
    const file = await this.composeFile();
    try {
      await runChecked(
        containerRuntimeCli(this.options, "Edgeshark needs Docker or Podman; a Kubernetes lab host has none."),
        ["compose", "-f", file, ...(action === "up" ? ["up", "-d"] : ["down"])],
        { env: { ...this.options.env, DOCKER_DEFAULT_PLATFORM: "" }, timeoutMs: 10 * 60_000 }
      );
    } finally {
      await fs.rm(file, { force: true });
    }
  }

  edgesharkInstall(): Promise<void> {
    return this.compose("up");
  }

  edgesharkUninstall(): Promise<void> {
    return this.compose("down");
  }

  async packetflix(targets: CaptureTarget[], remoteHostname?: string): Promise<CapturePacketflixResponse> {
    if (!(await this.edgesharkStatus()).running) {
      throw new LabBackendError(
        "Edgeshark is not running. Start it from settings before launching capture.",
        503
      );
    }
    const host = remoteHostname?.trim() || this.options.captureHostname;
    const inode = await hostNetworkNamespaceInode();
    const captures: CapturePacketflixURI[] = groupCaptureTargets(targets).map((group) => ({
      containerName: group.containerName,
      interfaceNames: group.interfaceNames,
      packetflixUri: packetflixUri(host, this.options.packetflixPort, group, inode)
    }));
    return { captures };
  }

  /** The Docker network of the Edgeshark containers, if they run. */
  private async edgesharkNetwork(): Promise<string | undefined> {
    try {
      const [container] = await this.docker().listContainers({ filters: { name: ["edgeshark"] } });
      return container ? Object.keys(container.NetworkSettings.Networks)[0] : undefined;
    } catch {
      return undefined;
    }
  }

  async createVnc(
    labName: string,
    labDirectory: string | undefined,
    targets: CaptureTarget[],
    theme?: string
  ): Promise<CaptureWiresharkVncCreateResponse> {
    if (!(await this.edgesharkStatus()).running) {
      throw new LabBackendError(
        "Edgeshark is not running. Start it from settings before launching capture.",
        503
      );
    }
    const network = await this.edgesharkNetwork();
    const captureHost = network ? "edgeshark-edgeshark-1" : "host.docker.internal";
    const inode = await hostNetworkNamespaceInode();
    const sessions: CaptureWiresharkVncSession[] = [];
    for (const group of groupCaptureTargets(targets)) {
      const session = await this.startVncContainer(containerRuntimeCli(this.options), {
        labName,
        containerName: group.containerName,
        interfaceNames: group.interfaceNames,
        packetflixLink: packetflixUri(captureHost, 5001, group, inode),
        ...(theme !== undefined ? { theme } : {}),
        runArgs: network ? [] : ["--add-host", "host.docker.internal:host-gateway"],
        ...(labDirectory ? { labDirectory } : {})
      });
      if (network) {
        await runCommand(containerRuntimeCli(this.options), ["network", "connect", network, session.containerId]);
      }
      sessions.push(publicVncSession(session));
    }
    return { sessions };
  }

  /**
   * Wireshark VNC of a c9s lab host on this machine: one container per node
   * on this machine's Docker or Podman. Its Wireshark captures from the
   * Packetflix server here with a session ticket, and each capture it starts
   * runs `containerlab -r c9s capture` through `open`. Closing the session
   * revokes the ticket, which ends its captures, and removes the container.
   */
  async createStreamVnc(
    labName: string,
    targets: readonly CaptureNodeTarget[],
    open: OpenGrantedCapture,
    theme?: string
  ): Promise<CaptureWiresharkVncCreateResponse> {
    const runtime = await this.vncRuntime();
    if (!runtime) throw new LabBackendError(WIRESHARK_VNC_NEEDS_DOCKER, 501);
    const byNode = new Map<string, CaptureNodeTarget[]>();
    for (const target of targets) byNode.set(target.node, [...(byNode.get(target.node) ?? []), target]);
    const started: VncSession[] = [];
    try {
      for (const [node, nodeTargets] of byNode) {
        const { ticket, packetflixUri: link } = await this.packetflixServer.mint({ labName, targets: nodeTargets, open });
        try {
          const session = await this.startVncContainer(runtime, {
            labName,
            containerName: `${labName}-${node}`,
            interfaceNames: nodeTargets.map((target) => target.interface),
            packetflixLink: link,
            ...(theme !== undefined ? { theme } : {}),
            runArgs: []
          });
          session.ticket = ticket;
          started.push(session);
        } catch (error) {
          this.packetflixServer.revoke(ticket);
          throw error;
        }
      }
    } catch (error) {
      await Promise.all(started.map((session) => this.closeVnc(session.sessionId).catch(() => {})));
      throw error;
    }
    return { sessions: started.map(publicVncSession) };
  }

  private async startVncContainer(runtime: string, spec: VncContainerSpec): Promise<VncSession> {
    const port = await freePort();
    const sessionId = randomBytes(16).toString("hex");
    const name = `clab_ws_vnc_${this.options.username}_${spec.containerName}_${spec.interfaceNames.join("-")}_${Date.now()}`
      .replace(/[^a-zA-Z0-9_.-]/g, "_")
      .slice(0, 120);
    const args = [
      "run",
      "-d",
      "--rm",
      "--name",
      name,
      "--label",
      "clab-wireshark-vnc=true",
      "-p",
      `127.0.0.1:${port}:${VNC_PORT}`,
      ...spec.runArgs,
      ...(spec.labDirectory ? ["-v", `${spec.labDirectory}:/pcaps`] : []),
      "-e",
      `PACKETFLIX_LINK=${spec.packetflixLink}`,
      ...(spec.theme === "dark" ? ["-e", "DARK_MODE=1"] : []),
      this.options.wiresharkImage
    ];
    const created = await runChecked(runtime, args, { env: this.options.env, timeoutMs: 10 * 60_000 });
    const containerId = created.stdout.trim().split("\n").pop() ?? name;
    const now = new Date();
    const session: VncSession = {
      sessionId,
      labName: spec.labName,
      containerName: spec.containerName,
      interfaceNames: spec.interfaceNames,
      vncPath: `/api/v1/capture/wireshark-vnc-sessions/${sessionId}/vnc/`,
      showVolumeTip: Boolean(spec.labDirectory),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + VNC_SESSION_TTL_MS).toISOString(),
      containerId,
      port,
      runtime
    };
    this.vncSessions.set(sessionId, session);
    return session;
  }

  private vncSession(sessionId: string): VncSession {
    const session = this.vncSessions.get(sessionId.trim());
    if (!session) throw new LabBackendError("Capture session not found", 404);
    return session;
  }

  async vncReady(sessionId: string): Promise<CaptureWiresharkVncReadyResponse> {
    const session = this.vncSession(sessionId);
    try {
      const response = await fetch(`http://127.0.0.1:${session.port}/`, {
        signal: AbortSignal.timeout(2000)
      });
      return { ready: response.status < 500, url: session.vncPath };
    } catch {
      return { ready: false, url: session.vncPath };
    }
  }

  /** Revokes the session's ticket, which ends its captures, and removes its container. */
  private async endVnc(session: VncSession): Promise<void> {
    this.vncSessions.delete(session.sessionId);
    if (session.ticket) this.packetflixServer.revoke(session.ticket);
    await runCommand(session.runtime, ["rm", "-f", session.containerId], { env: this.options.env }).catch(() => undefined);
  }

  async closeVnc(sessionId: string): Promise<void> {
    await this.endVnc(this.vncSession(sessionId));
  }

  async closeAllVnc(): Promise<CaptureCloseAllResponse> {
    const sessions = [...this.vncSessions.values()];
    await Promise.all(sessions.map((session) => this.endVnc(session)));
    return { message: `Closed ${sessions.length} capture session(s)`, closed: sessions.length };
  }

  async fetchVnc(sessionId: string, request: WiresharkVncRequest): Promise<WiresharkVncResponse> {
    const session = this.vncSession(sessionId);
    const response = await fetch(`http://127.0.0.1:${session.port}${request.path}`, {
      method: request.method,
      headers: request.headers,
      redirect: "manual"
    });
    return {
      status: response.status,
      headers: Array.from(response.headers.entries()),
      body: new Uint8Array(await response.arrayBuffer())
    };
  }

  connectVnc(sessionId: string, requestPath: string, options: { protocols: string[]; origin?: string }): WiresharkVncSocket {
    const session = this.vncSession(sessionId);
    const url = `ws://127.0.0.1:${session.port}${requestPath}`;
    const socketOptions = {
      perMessageDeflate: false,
      ...(options.origin ? { headers: { Origin: options.origin } } : {})
    };
    return wrapWebSocket(
      options.protocols.length > 0
        ? new WebSocket(url, options.protocols, socketOptions)
        : new WebSocket(url, socketOptions)
    );
  }

  async dispose(): Promise<void> {
    await this.closeAllVnc().catch(() => {});
    this.packetflixServer.close();
  }
}
