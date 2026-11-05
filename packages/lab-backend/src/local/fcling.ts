/**
 * A lab's fcling engine on this machine: a container on the lab's management
 * network that streams its nodes and keeps their history. Nothing is kept here:
 * its address and token are read back from the container, so an engine outlives
 * the app that started it.
 */
import { randomBytes } from "node:crypto";

import {
  FCLING_IMAGE,
  FCLING_PORT,
  fclingQueryString,
  isFclingApiCallAllowed,
  parseFclingEvents,
  type FclingApiRequest,
  type FclingApiResponse,
  type FclingEngineStatus,
  type FclingEvent
} from "@containerlab/clab-ui/fabric/engine";

import { LabBackendError } from "../contract/errors.ts";
import { containerRuntimeCli, type ResolvedLocalOptions } from "./options.ts";
import { runCommand, stripAnsi } from "./process.ts";

/** Marks an engine with its lab. Not `containerlab`: inspect would list it as a node. */
const ENGINE_LAB_LABEL = "clab-fcling-lab";
const TOKEN_ENV = "FCLI_API_TOKEN";
/** Long enough for a first pull of the image. */
const START_TIMEOUT_MS = 10 * 60_000;
const COMMAND_TIMEOUT_MS = 30_000;
const PROBE_TIMEOUT_MS = 2_000;
const LOG_TAIL_LINES = 12;
/** Every API call would otherwise ask the runtime where the engine is. */
const ADDRESS_TTL_MS = 10_000;

interface EngineContainer {
  running: boolean;
  exitCode: number;
  image?: string;
  startedAt?: string;
  url?: string;
  token?: string;
}

interface EngineAddress {
  url: string;
  token: string;
  expires: number;
}

/** What `inspect` says of a container, as far as the engine needs it. */
interface InspectedContainer {
  Config?: { Image?: string; Env?: string[] };
  State?: { Status?: string; Running?: boolean; ExitCode?: number; StartedAt?: string };
  NetworkSettings?: { Ports?: Record<string, Array<{ HostPort?: string }> | null> };
}

export function fclingContainerName(labName: string): string {
  return `clab-${labName}-fcling`;
}

/** The container's state. A runtime reports a port only while the container runs. */
export function parseEngineContainer(output: string): EngineContainer | undefined {
  const [container] = JSON.parse(output) as InspectedContainer[];
  if (!container) return undefined;
  const hostPort = container.NetworkSettings?.Ports?.[`${FCLING_PORT}/tcp`]?.[0]?.HostPort;
  const token = container.Config?.Env?.find((entry) => entry.startsWith(`${TOKEN_ENV}=`));
  return {
    running: container.State?.Running === true,
    exitCode: container.State?.ExitCode ?? 0,
    ...(container.Config?.Image ? { image: container.Config.Image } : {}),
    ...(container.State?.StartedAt ? { startedAt: container.State.StartedAt } : {}),
    ...(hostPort ? { url: `http://127.0.0.1:${hostPort}` } : {}),
    ...(token ? { token: token.slice(TOKEN_ENV.length + 1) } : {})
  };
}

export class LocalFcling {
  private readonly options: ResolvedLocalOptions;
  private readonly addresses = new Map<string, EngineAddress>();
  /** Two windows opening one lab's view start one engine. */
  private readonly starting = new Map<string, Promise<FclingEngineStatus>>();

  constructor(options: ResolvedLocalOptions) {
    this.options = options;
  }

  private get cli(): "docker" | "podman" {
    return containerRuntimeCli(
      this.options,
      "fcling needs Docker or Podman; a Kubernetes lab host has none."
    );
  }

  private run(args: string[], timeoutMs = COMMAND_TIMEOUT_MS) {
    return runCommand(this.cli, args, { env: this.options.env, timeoutMs });
  }

  private async inspect(labName: string): Promise<EngineContainer | undefined> {
    const result = await this.run(["inspect", "--type", "container", fclingContainerName(labName)]);
    return result.code === 0 ? parseEngineContainer(result.stdout) : undefined;
  }

  async status(labName: string): Promise<FclingEngineStatus> {
    const container = await this.inspect(labName);
    if (!container) return { state: "stopped" };
    const known = {
      containerName: fclingContainerName(labName),
      ...(container.image ? { image: container.image } : {}),
      ...(container.startedAt ? { startedAt: container.startedAt } : {})
    };
    if (container.running) {
      return { state: (await this.answers(container)) ? "ready" : "starting", ...known };
    }
    // A clean exit is someone stopping it, not a failure.
    if (container.exitCode === 0) return { state: "stopped" };
    return { state: "failed", ...known, error: await this.logTail(labName) };
  }

  private async answers(container: EngineContainer): Promise<boolean> {
    if (!container.url || !container.token) return false;
    try {
      const response = await fetch(`${container.url}/api/status`, {
        headers: { Authorization: `Bearer ${container.token}` },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async logTail(labName: string): Promise<string> {
    const result = await this.run(["logs", "--tail", String(LOG_TAIL_LINES), fclingContainerName(labName)]);
    return stripAnsi(`${result.stdout}${result.stderr}`).trim();
  }

  start(labName: string, topology: string, mgmtNetwork: string): Promise<FclingEngineStatus> {
    const pending = this.starting.get(labName);
    if (pending) return pending;
    const started = this.startEngine(labName, topology, mgmtNetwork).finally(() => {
      this.starting.delete(labName);
    });
    this.starting.set(labName, started);
    return started;
  }

  private async startEngine(
    labName: string,
    topology: string,
    mgmtNetwork: string
  ): Promise<FclingEngineStatus> {
    const current = await this.inspect(labName);
    if (current?.running) return this.status(labName);
    this.addresses.delete(labName);
    const name = fclingContainerName(labName);
    // What an earlier run left behind holds the name; the history stays in its volume.
    if (current) await this.run(["rm", "-f", name]);

    const args = (pull: string) => [
      "run",
      "-d",
      "--pull",
      pull,
      "--name",
      name,
      "--label",
      `${ENGINE_LAB_LABEL}=${labName}`,
      "--network",
      mgmtNetwork,
      // The runtime picks a free port, on this machine only.
      "-p",
      `127.0.0.1::${FCLING_PORT}`,
      "-v",
      `${topology}:/topo.yml:ro`,
      "-v",
      `${name}:/state`,
      "-e",
      `${TOKEN_ENV}=${randomBytes(24).toString("hex")}`,
      FCLING_IMAGE,
      "-t",
      "/topo.yml",
      "serve",
      "--host",
      "0.0.0.0",
      "--no-tls",
      "--persist-acks"
    ];
    let result = await this.run(args("always"), START_TIMEOUT_MS);
    if (result.code !== 0) {
      // Offline, the image at hand still does.
      const offline = await this.run(args("never"));
      if (offline.code !== 0) {
        const output = stripAnsi(`${result.stdout}${result.stderr}`).trim();
        throw new LabBackendError(`The fabric engine of lab '${labName}' did not start: ${output}`, 500);
      }
      result = offline;
    }
    void this.sweepOrphans(labName);
    return this.status(labName);
  }

  /**
   * Stops the engine; its history stays for the next start unless deleted with
   * the lab. Never fails: what stays running is reported by the next status.
   */
  async stop(labName: string, options: { deleteHistory?: boolean } = {}): Promise<void> {
    this.addresses.delete(labName);
    const name = fclingContainerName(labName);
    await this.run(["rm", "-f", name]).catch(() => undefined);
    if (options.deleteHistory) await this.run(["volume", "rm", name]).catch(() => undefined);
  }

  /** `containerlab destroy` leaves engines running: it only knows its own tool containers. */
  private async sweepOrphans(currentLab: string): Promise<void> {
    const listed = await this.run([
      "ps",
      "-a",
      "--filter",
      `label=${ENGINE_LAB_LABEL}`,
      "--format",
      `{{.Label "${ENGINE_LAB_LABEL}"}}`
    ]).catch(() => undefined);
    const labs = listed?.code === 0 ? listed.stdout.split("\n").map((line) => line.trim()) : [];
    for (const lab of labs) {
      if (!lab || lab === currentLab) continue;
      const nodes = await this.run(["ps", "-a", "-q", "--filter", `label=containerlab=${lab}`]).catch(
        () => undefined
      );
      if (nodes?.code === 0 && nodes.stdout.trim() === "") {
        await this.stop(lab, { deleteHistory: true });
      }
    }
  }

  private async address(labName: string): Promise<EngineAddress> {
    const known = this.addresses.get(labName);
    if (known && known.expires > Date.now()) return known;
    const container = await this.inspect(labName);
    if (!container?.running || !container.url || !container.token) {
      this.addresses.delete(labName);
      throw new LabBackendError(`The fabric engine of lab '${labName}' is not running.`, 409);
    }
    const address = { url: container.url, token: container.token, expires: Date.now() + ADDRESS_TTL_MS };
    this.addresses.set(labName, address);
    return address;
  }

  private async engineFetch(
    labName: string,
    path: string,
    init: RequestInit = {},
    headers: Record<string, string> = {}
  ): Promise<Response> {
    const { url, token } = await this.address(labName);
    try {
      return await fetch(`${url}/api/${path}`, {
        ...init,
        headers: { ...headers, Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      // Restarted on another port, perhaps: ask the runtime again next time.
      this.addresses.delete(labName);
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new LabBackendError(`The fabric engine of lab '${labName}' does not answer.`, 502, {
        cause: error
      });
    }
  }

  async api(labName: string, request: FclingApiRequest): Promise<FclingApiResponse> {
    if (!isFclingApiCallAllowed(request.method, request.path)) {
      throw new LabBackendError(`The fabric engine does not offer ${request.method} ${request.path}.`, 403);
    }
    const hasBody = request.body !== undefined;
    const response = await this.engineFetch(
      labName,
      `${request.path}${fclingQueryString(request.query)}`,
      {
        method: request.method,
        ...(hasBody ? { body: JSON.stringify(request.body) } : {})
      },
      hasBody ? { "Content-Type": "application/json" } : {}
    );
    const text = await response.text();
    try {
      return { status: response.status, body: text ? (JSON.parse(text) as unknown) : null };
    } catch {
      return { status: response.status, body: { error: text } };
    }
  }

  async events(
    labName: string,
    options: { after?: number; signal: AbortSignal }
  ): Promise<AsyncIterable<FclingEvent>> {
    const query = fclingQueryString(options.after === undefined ? {} : { after: String(options.after) });
    const response = await this.engineFetch(labName, `events${query}`, { signal: options.signal });
    if (!response.ok || !response.body) {
      throw new LabBackendError(`The fabric engine answered ${response.status} to its event stream.`, 502);
    }
    return parseFclingEvents(response.body as unknown as AsyncIterable<Uint8Array>);
  }
}
