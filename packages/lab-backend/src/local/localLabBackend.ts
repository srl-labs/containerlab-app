import fs from "node:fs/promises";
import path from "node:path";

import {
  containerlabDefaultTimeout,
  isTopologyFileName,
  type LabExecRequest,
  type LabOperationSupport,
  type LabSnapshotSaveRequest,
  type TailscaleStatus,
  type TopoViewerNodesAction
} from "@containerlab/clab-ui/host";
import Docker from "dockerode";

import type {
  LabBackend,
  LabBackendCapabilities,
  LabBackendFeatures,
  LabEvent,
  LabHostProfile,
  LabEventStreamOptions,
  LabLifecycleAction,
  LabStatsStreamOptions,
  LabTarget,
  LifecycleRunOptions,
  NodeLogStreamOptions,
  RenderedTopology,
  TerminalCreateOptions,
  TopologyFileSystem,
  TopologyFilesOptions,
  WiresharkVncRequest
} from "../contract/backend.ts";
import type {
  CaptureInterface,
  CaptureStreamOptions,
  CaptureTarget,
  GenerateTopologyRequest,
  GraphExportFormat,
  ImportTopologyFromUrlResponse,
  InspectAllLabsResponse,
  InspectContainerInfo,
  MermaidDirection,
  NetemResetRequest,
  NetemSetRequest,
  NodeLifecycleAction,
  NodeLogLine,
  ShareToolAction,
  ShareToolOptions,
  SSHAccessResponse
} from "../contract/dto.ts";
import { LabBackendError } from "../contract/errors.ts";
import { containerRuntimeFeatures } from "../contract/support.ts";
import { readJsonLines } from "../ndjson.ts";
import { captureNodeTargets } from "../capture.ts";
import { LocalCapture, WIRESHARK_VNC_NEEDS_DOCKER } from "./capture.ts";
import { c9sCaptureArgs, listC9sCaptureInterfaces, spawnC9sCapture } from "./c9sCapture.ts";
import { createDockerNodeAccess } from "./dockerNodeAccess.ts";
import { inspectField } from "./inspect.ts";
import { createKubeClient, type KubeClient } from "./kube/kubeClient.ts";
import { loadKubeConfig } from "./kube/kubeConfig.ts";
import type { C9sContainerRecord } from "./kube/inspect.ts";
import { KubeNodeAccess } from "./kube/kubeNodeAccess.ts";
import type { NodeAccess } from "./nodeAccess.ts";
import {
  localExec,
  localInspectDetails,
  localNodesAction,
  localOperationSupport,
  localSaveSnapshots,
  type LocalLabRef
} from "./labOperations.ts";
import { LocalLifecycle } from "./lifecycle.ts";
import {
  containerRuntimeCli,
  resolveLocalOptions,
  type LocalLabBackendOptions,
  type ResolvedLocalOptions
} from "./options.ts";
import {
  containerlabCommand,
  lastContainerlabError,
  runChecked,
  runCommand,
  spawnLines,
  stripAnsi,
  type StreamingCommand
} from "./process.ts";
import { isRunningTopologyHere } from "./runningTopology.ts";
import { LocalTerminals } from "./terminals.ts";
import { localTopologyVariables, renderTopologyFile } from "./topologyTemplates.ts";
import * as tools from "./tools.ts";
import {
  createLocalTopologyFiles,
  discoverTopologies,
  isValidLabName,
  resolveTopologyPath,
  watchTopologyDocument
} from "./topologyFiles.ts";
import { LocalWorkspace } from "./workspace.ts";

const LOCAL_CAPABILITIES: LabBackendCapabilities = {
  sshAccess: false,
  deployFromUrl: true,
  importFromUrl: true,
  edgesharkManagement: true,
  wiresharkVnc: true,
  healthMetrics: true,
  sharedWorkspace: false,
  // containerlab has no command that reports it.
  tailscaleStatus: false
};

/**
 * What a local host can do, by its lab runtime; c9s has node stats when
 * metrics.k8s.io answers, and Wireshark VNC with Docker or Podman on this machine.
 */
function localFeatures(
  runtime: ResolvedLocalOptions["runtime"],
  nodeStats: boolean,
  captureVnc = false
): LabBackendFeatures {
  const c9s = runtime === "c9s";
  return {
    validate: true,
    graphMermaid: true,
    graphDot: true,
    // `tools sshx` and `tools gotty` run containers next to the lab.
    sshxReaders: !c9s,
    gottyOptions: !c9s,
    nodeStats,
    terminalResume: true,
    // containerlab's `--timeout`.
    lifecycleTimeout: true,
    ...containerRuntimeFeatures(!c9s),
    // `containerlab inspect interfaces -r c9s` lists the lab-link interfaces.
    interfaceInspect: true,
    manifestExport: c9s,
    c9sDeployOptions: c9s,
    captureStream: c9s,
    captureVnc: c9s && captureVnc
  };
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

function isUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

/**
 * A lab backend on this machine: the containerlab CLI, the container runtime
 * and the local disk, with the same results as clab-api-server.
 */
export class LocalLabBackend implements LabBackend {
  readonly kind = "local";
  readonly capabilities = LOCAL_CAPABILITIES;
  readonly options: ResolvedLocalOptions;
  readonly fs: LocalWorkspace;
  private dockerClient: Docker | undefined;
  private readonly lifecycle: LocalLifecycle;
  private readonly terminals: LocalTerminals;
  /** How the backend reaches nodes beyond the CLI: Docker, or Kubernetes for c9s. */
  private readonly access: NodeAccess;
  private kubeClient: KubeClient | undefined;
  private readonly capture: LocalCapture;
  private support: Promise<LabOperationSupport> | undefined;
  /** Running `containerlab events` commands; they must not outlive the app. */
  private readonly eventCommands = new Set<StreamingCommand>();

  constructor(options: LocalLabBackendOptions = {}, overrides: { kubeClient?: KubeClient } = {}) {
    this.options = resolveLocalOptions(options);
    this.fs = new LocalWorkspace(this.options.workspaceRoot);
    const docker = () => this.docker;
    if (overrides.kubeClient) this.kubeClient = overrides.kubeClient;
    this.access =
      this.options.runtime === "c9s"
        ? new KubeNodeAccess(this.options, () => this.kube)
        : createDockerNodeAccess(this.options, docker);
    this.terminals = new LocalTerminals(this.access, this.options.username);
    this.capture = new LocalCapture(this.options, docker);
    this.lifecycle = new LocalLifecycle({
      options: this.options,
      resolveTopology: (labName, rawPath) => this.resolveTopology(labName, rawPath),
      runningTopologyFile: (labName) => this.runningTopologyFile(labName),
      inspectLab: (labName) => this.inspectLab(labName),
      labEnv: (labName) => this.labEnv(labName)
    });
  }

  get scope(): string {
    const { c9s, workspaceRoot } = this.options;
    // A cluster is another lab host than this machine, although the files are the same.
    if (!c9s) return `local:${workspaceRoot}`;
    // The same context name in another kubeconfig file can be another cluster.
    const cluster = c9s.kubeconfig ? `${c9s.kubeContext ?? ""}@${c9s.kubeconfig}` : (c9s.kubeContext ?? "");
    return `local-c9s:${cluster}:${workspaceRoot}`;
  }

  /** One Kubernetes client per backend, from the host's kubeconfig and context, made on first use. */
  private get kube(): KubeClient {
    this.kubeClient ??= createKubeClient(loadKubeConfig(this.options.c9s ?? {}, this.options.env));
    return this.kubeClient;
  }

  /** The Docker Engine API of the container runtime. */
  get docker(): Docker {
    this.dockerClient ??= new Docker({ socketPath: this.options.dockerSocketPath });
    return this.dockerClient;
  }

  /**
   * The absolute topology path for a lab: absolute paths and URLs as given,
   * other paths resolved in the workspace like clab-api-server does.
   */
  async resolveTopology(labName: string, rawPath: string): Promise<string> {
    const trimmed = rawPath.trim();
    if (isUrl(trimmed) || path.isAbsolute(trimmed)) return trimmed;
    const resolved = await resolveTopologyPath(this.fs.paths, labName, trimmed);
    try {
      await fs.access(resolved);
    } catch {
      throw new LabBackendError(`Topology file not found for lab '${labName}'.`, 404);
    }
    return resolved;
  }

  async runningTopologyFile(labName: string): Promise<string | undefined> {
    const containers = (await this.access.inspectLabs(labName))[labName] ?? [];
    for (const container of containers) {
      const file = inspectField(container, "absLabPath", "labPath");
      if (file) return file;
    }
    return undefined;
  }

  private async requireRunningTopology(labName: string): Promise<string> {
    const file = await this.runningTopologyFile(labName);
    if (!file) throw new LabBackendError(`Lab '${labName}' not found.`, 404);
    return file;
  }

  private async container(labName: string, containerName: string): Promise<InspectContainerInfo> {
    const containers = await this.inspectLab(labName);
    const match = containers.find(
      (container) =>
        container.name === containerName || inspectField(container, "container_id", "containerId") === containerName
    );
    if (!match) {
      throw new LabBackendError(`Container '${containerName}' does not belong to lab '${labName}'`, 404);
    }
    return match;
  }

  version() {
    return tools.containerlabVersion(this.options);
  }

  versionCheck() {
    return tools.containerlabVersionCheck(this.options);
  }

  async healthMetrics() {
    if (this.options.runtime === "c9s") {
      throw new LabBackendError("A cluster lab host has no host metrics; this machine's would mislead.", 501);
    }
    const version = await this.version().then(
      (response) => /version: (\S+)/.exec(response.versionInfo)?.[1] ?? "unknown",
      () => "unknown"
    );
    return tools.hostMetrics(version);
  }

  inspectAll(): Promise<InspectAllLabsResponse> {
    return this.access.inspectLabs();
  }

  async inspectLab(labName: string) {
    const containers = (await this.access.inspectLabs(labName))[labName];
    if (!containers || containers.length === 0) {
      throw new LabBackendError(`Lab '${labName}' not found.`, 404);
    }
    return containers;
  }

  async isLabRunning(labName: string): Promise<boolean> {
    return ((await this.access.inspectLabs(labName))[labName]?.length ?? 0) > 0;
  }

  runLifecycle(action: LabLifecycleAction, lab: LabTarget, options?: LifecycleRunOptions) {
    return this.lifecycle.run(action, lab, options);
  }

  streamLifecycle(action: LabLifecycleAction, lab: LabTarget, options?: LifecycleRunOptions) {
    return this.lifecycle.stream(action, lab, options);
  }

  async deployFromUrl(source: { url: string; labName?: string }): Promise<InspectAllLabsResponse> {
    const before = new Set(Object.keys(await this.inspectAll()));
    const args = ["deploy", "-r", this.options.runtime, ...this.options.deployExtraArgs, "-t", source.url];
    if (source.labName) args.push("--name", source.labName);
    await fs.mkdir(this.options.workspaceRoot, { recursive: true });
    const [file, commandArgs] = containerlabCommand(this.options, args);
    await runChecked(file, commandArgs, {
      cwd: this.options.workspaceRoot,
      env: this.options.env,
      timeoutMs: 30 * 60_000
    });
    const after = await this.inspectAll();
    return Object.fromEntries(Object.entries(after).filter(([labName]) => !before.has(labName)));
  }

  /** The topology file of a lab: the host's absolute path, else the running lab's. */
  private async labTopology(lab: LabTarget): Promise<string> {
    if (lab.path && path.isAbsolute(lab.path)) return lab.path;
    if (lab.path) return this.resolveTopology(lab.labName, lab.path);
    return this.requireRunningTopology(lab.labName);
  }

  async save(lab: LabTarget, options: { nodeFilter?: string; copyDir?: string } = {}) {
    const copyDir = options.copyDir?.trim();
    if (copyDir && !(await this.labOperationSupport()).saveCopy) {
      throw new LabBackendError("This containerlab cannot copy saved configs; update it to 0.73 or later.", 501);
    }
    const topology = await this.labTopology(lab);
    if (!(await isRunningTopologyHere(this.options.runtime, topology))) {
      // A c9s lab whose topology file is not on this machine: save it by name.
      const args = ["save", "-r", "c9s", "--name", lab.labName, ...(copyDir ? [`--copy=${copyDir}`] : [])];
      const [file, commandArgs] = containerlabCommand(this.options, args);
      const result = await runChecked(file, commandArgs, {
        cwd: this.options.workspaceRoot,
        env: await this.labEnv(lab.labName),
        timeoutMs: 10 * 60_000
      });
      return {
        message: `Configuration save command executed successfully for lab '${lab.labName}'.`,
        output: stripAnsi(`${result.stderr}${result.stdout}`).trim() || "Configuration saved",
        ...(copyDir ? { copyDir: path.resolve(this.options.workspaceRoot, copyDir) } : {})
      };
    }
    return tools.saveLab(
      { ...this.options, env: await this.labEnv(lab.labName) },
      topology,
      options.nodeFilter,
      copyDir
    );
  }

  labOperationSupport(): Promise<LabOperationSupport> {
    this.support ??= this.version().then(
      (response) => localOperationSupport(/version: (\S+)/.exec(response.versionInfo)?.[1]),
      () => localOperationSupport(undefined)
    );
    return this.support;
  }

  /** The running lab's topology file, or its name when containerlab has none. */
  private async labRef(lab: LabTarget): Promise<LocalLabRef> {
    try {
      const topology = await this.labTopology(lab);
      // A c9s lab whose topology file is not on this machine goes by its name.
      if (!(await isRunningTopologyHere(this.options.runtime, topology))) return { labName: lab.labName };
      return { topology, labName: lab.labName };
    } catch (error) {
      if (lab.labName) return { labName: lab.labName };
      throw error;
    }
  }

  /** The options of a command on one lab, with its c9s namespace. */
  private async labOptions(labName: string): Promise<ResolvedLocalOptions> {
    const env = await this.labEnv(labName);
    return env === this.options.env ? this.options : { ...this.options, env };
  }

  async exec(lab: LabTarget, request: LabExecRequest) {
    return localExec(await this.labOptions(lab.labName), await this.labRef(lab), request);
  }

  async nodesAction(lab: LabTarget, nodeNames: string[], action: TopoViewerNodesAction) {
    return localNodesAction(await this.labOptions(lab.labName), await this.labRef(lab), nodeNames, action);
  }

  async saveSnapshots(lab: LabTarget, request: LabSnapshotSaveRequest) {
    if (!(await this.labOperationSupport()).snapshotSave) {
      throw new LabBackendError("This containerlab cannot save VM snapshots; update it to 0.72 or later.", 501);
    }
    return localSaveSnapshots(this.options, await this.labTopology(lab), request);
  }

  async inspectLabDetails(lab: LabTarget) {
    return localInspectDetails(await this.labOptions(lab.labName), await this.labRef(lab));
  }

  /** The topology file of a lab that need not be running, like clab-api-server finds it. */
  private async topologyFile(lab: LabTarget): Promise<string> {
    return lab.path || (await this.runningTopologyFile(lab.labName))
      ? this.labTopology(lab)
      : this.resolveTopology(lab.labName, `${lab.labName}/${lab.labName}.clab.yml`);
  }

  async graphDrawio(
    lab: LabTarget,
    options: { layout: "horizontal" | "vertical" | "interactive"; theme?: string }
  ) {
    return tools.drawioGraph(this.options, await this.topologyFile(lab), options.layout, options.theme);
  }

  async graphExport(lab: LabTarget, format: GraphExportFormat, options: { direction?: MermaidDirection } = {}) {
    return tools.graphExport(this.options, await this.topologyFile(lab), format, options.direction);
  }

  async validate(lab: LabTarget) {
    return tools.validateTopology(this.options, await this.topologyFile(lab));
  }

  generateTopology(request: GenerateTopologyRequest) {
    return tools.generateTopology(this.options, request);
  }

  async features(): Promise<LabBackendFeatures> {
    if (this.options.runtime !== "c9s") return localFeatures(this.options.runtime, true);
    const [nodeStats, vncRuntime] = await Promise.all([this.access.statsAvailable(), this.capture.vncRuntime()]);
    return localFeatures(this.options.runtime, nodeStats, vncRuntime !== undefined);
  }

  async hostProfile(): Promise<LabHostProfile> {
    const { runtime, c9s } = this.options;
    const defaultTimeout = containerlabDefaultTimeout(runtime);
    if (!c9s) return { runtime, defaultTimeout };
    const vncRuntime = await this.capture.vncRuntime();
    return {
      runtime,
      defaultTimeout,
      ...(c9s.kubeContext ? { kubeContext: c9s.kubeContext } : {}),
      ...(c9s.kubeconfig ? { kubeconfig: c9s.kubeconfig } : {}),
      namespaceMode: c9s.namespace ? "fixed" : "per-lab",
      ...(c9s.namespace ? { namespace: c9s.namespace } : {}),
      ...(c9s.exposeType ? { exposeType: c9s.exposeType } : {}),
      persistence: c9s.persistence !== false,
      ...(c9s.imagePullSecret ? { imagePullSecret: c9s.imagePullSecret } : {}),
      ...(vncRuntime ? {} : { wiresharkVncUnavailable: WIRESHARK_VNC_NEEDS_DOCKER })
    };
  }

  /** `containerlab deploy -r c9s --emit-crs`: the resources a deploy would create, without a cluster. */
  async exportManifests(lab: LabTarget): Promise<{ yaml: string }> {
    if (this.options.runtime !== "c9s") {
      throw new LabBackendError("Kubernetes manifests need a c9s lab host.", 501);
    }
    const topology = await this.topologyFile(lab);
    if (!(await isRunningTopologyHere(this.options.runtime, topology))) {
      throw new LabBackendError(`Lab '${lab.labName}' has no topology file on this machine to export.`, 404);
    }
    const c9s = this.options.c9s ?? {};
    const args = ["deploy", "-r", "c9s", "--emit-crs", "-t", topology];
    if (lab.labName) args.push("--name", lab.labName);
    if (c9s.exposeType) args.push("--expose-type", c9s.exposeType);
    if (c9s.persistence === false) args.push("--no-persistence");
    if (c9s.imagePullSecret) args.push("--image-pull-secret", c9s.imagePullSecret);
    const [file, commandArgs] = containerlabCommand(this.options, args);
    const result = await runChecked(file, commandArgs, {
      cwd: path.dirname(topology),
      env: this.options.env,
      timeoutMs: 2 * 60_000
    });
    return { yaml: result.stdout };
  }

  async fcli(lab: LabTarget, command: string) {
    const containers = await this.inspectLab(lab.labName);
    const network = inspectField(containers[0], "mgmt_network") || "clab";
    return tools.fcli(this.options, await this.labTopology(lab), network, command);
  }

  /**
   * A containerlab command line for a terminal, for interactive commands such
   * as `graph --drawio-args -I`. Arguments are quoted for a POSIX shell.
   */
  commandLine(args: string[]): string {
    const [file, commandArgs] = containerlabCommand(this.options, args);
    return [file, ...commandArgs].map(shellQuote).join(" ");
  }

  /**
   * `git clone <url> <destination>`, for any Git host the user can reach.
   * importTopologyFromUrl only takes GitHub and GitLab, like clab-api-server.
   */
  async cloneRepository(url: string, destination: string): Promise<void> {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await runChecked("git", ["clone", url, destination], {
      env: this.options.env,
      timeoutMs: 10 * 60_000
    });
  }

  shareTool(tool: "sshx" | "gotty", labName: string, action: ShareToolAction, options: ShareToolOptions = {}) {
    return tools.shareTool(this.options, tool, labName, action, options);
  }

  /**
   * `containerlab inspect --all --details`: every lab's containers with their
   * runtime details and labels, keyed by lab name.
   */
  async inspectDetails(): Promise<Record<string, unknown[]>> {
    const [file, args] = containerlabCommand(this.options, [
      "inspect",
      "-r",
      this.options.runtime,
      "--all",
      "--details",
      "--format",
      "json"
    ]);
    const result = await runChecked(file, args, { env: this.options.env, timeoutMs: 60_000 });
    const start = result.stdout.indexOf("{");
    if (start < 0) return {};
    const parsed = JSON.parse(result.stdout.slice(start)) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown[]>) : {};
  }

  /**
   * `containerlab inspect interfaces`: the interfaces of one container. On
   * c9s, the lab-link interfaces of the node (`-r c9s --name <lab> -n <node>`).
   */
  async inspectInterfaces(topology: string, containerName: string): Promise<unknown[]> {
    let commandArgs = ["inspect", "interfaces", "-t", topology, "-f", "json", "-n", containerName];
    let env = this.options.env;
    if (this.options.runtime === "c9s") {
      const labs = await this.access.inspectLabs();
      const [labName, container] =
        Object.entries(labs)
          .map(([name, containers]) => [name, containers.find((record) => record.name === containerName)] as const)
          .find(([, record]) => record !== undefined) ?? [];
      if (!labName || !container) throw new LabBackendError(`Node ${containerName} is not running.`, 404);
      const nodeName = await this.access.topologyNodeName(container);
      commandArgs = ["inspect", "interfaces", "-r", "c9s", "--name", labName, "-f", "json", "-n", nodeName];
      env = await this.labEnv(labName);
    }
    const [file, args] = containerlabCommand(this.options, commandArgs);
    const result = await runChecked(file, args, { env, timeoutMs: 30_000 });
    const parsed = JSON.parse(result.stdout.slice(Math.max(0, result.stdout.indexOf("[")))) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  }

  /** The sshx or GoTTY sessions of all labs, as `containerlab tools <tool> list` reports them. */
  listShareSessions(tool: "sshx" | "gotty"): Promise<unknown[]> {
    return tools.listShareSessions(this.options, tool);
  }

  async nodeAction(labName: string, containerName: string, action: NodeLifecycleAction): Promise<void> {
    const container = await this.container(labName, containerName);
    if (action === "pause" || action === "unpause") {
      if (this.options.runtime === "c9s") {
        throw new LabBackendError("Nodes on a c9s lab host cannot be paused.", 501);
      }
      await runChecked(containerRuntimeCli(this.options), [action, container.name], { env: this.options.env });
      return;
    }
    const topology = await this.requireRunningTopology(labName);
    const nodeName = await this.access.topologyNodeName(container);
    // A c9s lab whose topology file is not on this machine goes by its name.
    const target = (await isRunningTopologyHere(this.options.runtime, topology))
      ? ["-t", topology]
      : ["--name", labName];
    const [file, args] = containerlabCommand(this.options, [
      action,
      "-r",
      this.options.runtime,
      ...target,
      "-n",
      nodeName
    ]);
    await runChecked(file, args, {
      ...(target[0] === "-t" ? { cwd: path.dirname(topology) } : {}),
      env: await this.labEnv(labName),
      timeoutMs: 10 * 60_000
    });
  }

  /**
   * The environment of a command on one lab: on c9s, the lab's namespace
   * from inspect, so labs deployed with a namespace option are found again.
   * A lab in its own namespace (`c9s-<lab>`) goes without one: containerlab
   * finds it there, and deletes that namespace on `destroy --cleanup` only
   * when no namespace was given.
   */
  async labEnv(labName: string): Promise<NodeJS.ProcessEnv> {
    if (this.options.runtime !== "c9s" || this.options.c9s?.namespace) return this.options.env;
    const records = await this.access.inspectLabs(labName).catch(() => ({}) as InspectAllLabsResponse);
    const namespace = inspectField(records[labName]?.[0] ?? ({} as InspectContainerInfo), "namespace");
    if (!namespace || namespace === `c9s-${labName}`) return this.options.env;
    return { ...this.options.env, CLAB_KUBE_NAMESPACE: namespace };
  }

  async nodeLogs(labName: string, containerName: string, options: { tail?: string } = {}) {
    const container = await this.container(labName, containerName);
    return this.access.nodeLogs(container, options.tail ?? "all");
  }

  async streamNodeLogs(
    labName: string,
    containerName: string,
    options: NodeLogStreamOptions
  ): Promise<AsyncIterable<NodeLogLine>> {
    const container = await this.container(labName, containerName);
    return this.access.streamNodeLogs(container, { tail: options.tail ?? "all", signal: options.signal });
  }

  async streamLabStats(labName: string, options: LabStatsStreamOptions) {
    await this.inspectLab(labName);
    if (!(await this.access.statsAvailable())) {
      throw new LabBackendError("This lab host does not report node stats (metrics.k8s.io is missing).", 501);
    }
    const interval = Math.min(20, Math.max(1, Math.round(options.intervalSeconds ?? 2)));
    return this.access.labStats(labName, interval, options.signal);
  }

  async nodeBrowserPorts(labName: string, containerName: string) {
    const container = await this.container(labName, containerName);
    return {
      nodeName: inspectField(container, "nodeName") || container.name,
      containerName: container.name,
      ports: await this.access.browserPorts(container)
    };
  }

  tailscaleStatus(): Promise<TailscaleStatus> {
    return Promise.reject(
      new LabBackendError("Tailscale status is only available through clab-api-server.", 501)
    );
  }

  requestSshAccess(): Promise<SSHAccessResponse> {
    return Promise.reject(
      new LabBackendError("SSH access sessions are only available through clab-api-server.", 501)
    );
  }

  async createTerminal(labName: string, containerName: string, options: TerminalCreateOptions) {
    const container = await this.container(labName, containerName);
    const node = container as unknown as Partial<C9sContainerRecord>;
    return this.terminals.create(
      {
        labName,
        nodeName: inspectField(container, "nodeName") || container.name,
        containerId: inspectField(container, "container_id", "containerId") || container.name,
        kind: inspectField(container, "kind"),
        ipv4Address: inspectField(container, "ipv4_address", "ipv4Address"),
        // c9s: where containerlab says the node runs.
        ...(node.namespace ? { namespace: node.namespace } : {}),
        ...(node.pod ? { pod: node.pod } : {}),
        ...(node.container ? { container: node.container } : {}),
        ...(node.load_balancer_address ? { loadBalancerAddress: node.load_balancer_address } : {}),
        ...(node.exposed_ports?.length ? { exposedPorts: node.exposed_ports } : {})
      },
      options
    );
  }

  async getTerminal(sessionId: string) {
    return this.terminals.get(sessionId);
  }

  async closeTerminal(sessionId: string) {
    this.terminals.close(sessionId);
  }

  attachTerminal(sessionId: string) {
    return this.terminals.attach(sessionId);
  }

  netemShow(containerName: string) {
    return tools.netemShow(this.options, containerName);
  }

  netemSet(request: NetemSetRequest) {
    return tools.netemSet(this.options, request);
  }

  netemReset(request: NetemResetRequest) {
    return tools.netemReset(this.options, request);
  }

  edgesharkStatus() {
    return this.capture.edgesharkStatus();
  }

  edgesharkInstall() {
    return this.capture.edgesharkInstall();
  }

  edgesharkUninstall() {
    return this.capture.edgesharkUninstall();
  }

  capturePacketflix(_labName: string, request: { targets: CaptureTarget[]; remoteHostname?: string }) {
    return this.capture.packetflix(request.targets, request.remoteHostname);
  }

  async createWiresharkVnc(labName: string, request: { targets: CaptureTarget[]; theme?: string }) {
    if (this.options.runtime === "c9s") {
      // Wireshark VNC fed by this machine's capture stream of the cluster lab.
      const records = (await this.access.inspectLabs(labName))[labName] ?? [];
      if (records.length === 0) throw new LabBackendError(`Lab '${labName}' is not running.`, 404);
      const targets = captureNodeTargets(labName, request.targets, records);
      return this.capture.createStreamVnc(
        labName,
        targets,
        (granted, signal) =>
          this.openCaptureStream(labName, {
            targets: granted.map((target) => ({ containerName: target.node, interfaceName: target.interface })),
            signal
          }),
        request.theme
      );
    }
    const topology = await this.runningTopologyFile(labName);
    const labDirectory = topology ? path.join(path.dirname(topology), `clab-${labName}`) : undefined;
    return this.capture.createVnc(labName, labDirectory, request.targets, request.theme);
  }

  private requireCaptureStream(): void {
    if (this.options.runtime !== "c9s") {
      throw new LabBackendError(
        "Capture streams need a c9s lab host; this machine captures with Edgeshark.",
        501
      );
    }
  }

  /** `containerlab -r c9s capture --name <lab> --list -f json`. */
  async captureInterfaces(labName: string): Promise<CaptureInterface[]> {
    this.requireCaptureStream();
    return listC9sCaptureInterfaces(this.options, labName, await this.labEnv(labName));
  }

  /** `containerlab -r c9s capture --name <lab> --target … -w -`, its stdout as pcapng. */
  async openCaptureStream(labName: string, options: CaptureStreamOptions): Promise<AsyncIterable<Uint8Array>> {
    this.requireCaptureStream();
    const records = (await this.access.inspectLabs(labName))[labName] ?? [];
    if (records.length === 0) throw new LabBackendError(`Lab '${labName}' is not running.`, 404);
    const args = c9sCaptureArgs({
      labName,
      targets: captureNodeTargets(labName, options.targets, records),
      ...(options.duration !== undefined ? { duration: options.duration } : {}),
      ...(options.packetLimit !== undefined ? { packetLimit: options.packetLimit } : {}),
      ...(options.snapLength !== undefined ? { snapLength: options.snapLength } : {})
    });
    return spawnC9sCapture(this.options, args, {
      env: await this.labEnv(labName),
      signal: options.signal,
      ...(options.onGap ? { onGap: options.onGap } : {})
    });
  }

  /**
   * The shell command a terminal runs to capture into a pipe, e.g. into
   * `wireshark -k -i -`: `containerlab -r c9s capture … -w -`, with the
   * cluster settings as environment variables. Arguments are quoted for a POSIX shell.
   */
  async captureCommandLine(
    labName: string,
    targets: CaptureTarget[],
    options: { duration?: string; packetLimit?: number } = {}
  ): Promise<{ command: string; env: Record<string, string> }> {
    this.requireCaptureStream();
    const records = (await this.access.inspectLabs(labName))[labName] ?? [];
    const args = c9sCaptureArgs({ labName, targets: captureNodeTargets(labName, targets, records), ...options });
    const env = await this.labEnv(labName);
    const clusterEnv = Object.fromEntries(
      ["CLAB_KUBE_CONTEXT", "CLAB_KUBECONFIG", "CLAB_KUBE_NAMESPACE"].flatMap((key) =>
        env[key] ? [[key, env[key]]] : []
      )
    );
    return { command: this.commandLine(args), env: clusterEnv };
  }

  wiresharkVncReady(sessionId: string) {
    return this.capture.vncReady(sessionId);
  }

  closeWiresharkVnc(sessionId: string) {
    return this.capture.closeVnc(sessionId);
  }

  closeAllWiresharkVnc() {
    return this.capture.closeAllVnc();
  }

  fetchWiresharkVnc(sessionId: string, request: WiresharkVncRequest) {
    return this.capture.fetchVnc(sessionId, request);
  }

  connectWiresharkVnc(sessionId: string, requestPath: string, options: { protocols: string[]; origin?: string }) {
    return this.capture.connectVnc(sessionId, requestPath, options);
  }

  listImages() {
    return tools.listImages(this.options);
  }

  pullImage(image: string) {
    return tools.pullImage(this.options, image);
  }

  removeImage(reference: string, force = false) {
    return tools.removeImage(this.options, reference, force);
  }

  listTopologies() {
    return discoverTopologies(this.fs.paths, this.options.env);
  }

  async importTopologyFromUrl(source: { url: string; labName?: string }): Promise<ImportTopologyFromUrlResponse> {
    const repository = parseRepositoryUrl(source.url);
    const labName = source.labName?.trim() || repository.name;
    if (!isValidLabName(labName)) throw new LabBackendError(`Invalid lab name '${labName}'`, 400);
    const directory = this.fs.paths.absolute(labName);
    try {
      await fs.access(directory);
      throw new LabBackendError(`Lab '${labName}' already exists.`, 409);
    } catch (error) {
      if (error instanceof LabBackendError) throw error;
    }
    await fs.mkdir(this.options.workspaceRoot, { recursive: true, mode: 0o750 });
    const cloneArgs = ["clone", "--depth", "1"];
    if (repository.branch) cloneArgs.push("--branch", repository.branch);
    const result = await runCommand("git", [...cloneArgs, repository.cloneUrl, directory], {
      env: { ...this.options.env, GIT_TERMINAL_PROMPT: "0" },
      timeoutMs: 10 * 60_000
    });
    if (result.code !== 0) {
      await fs.rm(directory, { recursive: true, force: true });
      throw new LabBackendError(`git clone failed: ${result.stderr.trim()}`, 502);
    }
    const prefix = repository.subPath ? `${labName}/${repository.subPath}` : `${labName}/`;
    const topologies = (await this.listTopologies()).filter((entry) =>
      repository.subPath && isTopologyFileName(repository.subPath)
        ? entry.yamlFileName === prefix
        : entry.yamlFileName.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`)
    );
    const topology = topologies.sort(
      (left, right) => left.yamlFileName.split("/").length - right.yamlFileName.split("/").length
    )[0];
    if (!topology) {
      throw new LabBackendError(`No topology file found in ${source.url}`, 404);
    }
    return {
      success: true,
      labName: topology.labName,
      fileName: path.posix.basename(topology.yamlFileName),
      topology
    };
  }

  topologyFiles(options: TopologyFilesOptions): TopologyFileSystem {
    return createLocalTopologyFiles(this.fs.paths, options, (labName) => this.runningTopologyFile(labName));
  }

  async runningTopologyYaml(labName: string): Promise<string> {
    return this.topologyFiles({
      labName,
      sourcePreference: "running-lab-doc",
      yamlPath: `${labName}.clab.yml`
    }).readFile(`${labName}.clab.yml`);
  }

  /** The topology file of a lab target: its workspace or absolute path, else the running lab's. */
  private async targetTopologyFile(lab: LabTarget): Promise<string> {
    if (lab.path) return this.resolveTopology(lab.labName, lab.path);
    return this.requireRunningTopology(lab.labName);
  }

  async renderTopology(lab: LabTarget, options: { varsFile?: string } = {}): Promise<RenderedTopology> {
    return renderTopologyFile(this.options, await this.targetTopologyFile(lab), options.varsFile);
  }

  async topologyVariables(lab: LabTarget, request: { labName: string; envNames: string[] }) {
    return localTopologyVariables(this.options, await this.targetTopologyFile(lab), request);
  }

  watchTopology(labName: string, filePath: string, signal: AbortSignal) {
    return watchTopologyDocument(this.fs.paths, labName, filePath, signal);
  }

  async events(options: LabEventStreamOptions, signal: AbortSignal): Promise<AsyncIterable<LabEvent>> {
    const args = ["events", "-r", this.options.runtime, "--format", "json"];
    if (options.initialState) args.push("--initial-state");
    if (options.interfaceStats) {
      args.push("--interface-stats");
      if (options.interfaceStatsInterval) args.push("--interface-stats-interval", options.interfaceStatsInterval);
    }
    const [file, commandArgs] = containerlabCommand(this.options, args);
    const command = await spawnLines(file, commandArgs, { env: this.options.env, signal });
    const running = this.eventCommands;
    running.add(command);
    void command.exit.then(() => running.delete(command));
    async function* lines(): AsyncGenerator<string> {
      const stderr: string[] = [];
      try {
        for await (const output of command.lines) {
          if (output.stream === "stdout") {
            yield `${output.line}\n`;
          } else {
            stderr.push(output.line);
            if (stderr.length > 40) stderr.shift();
          }
        }
        const exit = await command.exit;
        if (exit.code !== 0 && exit.code !== null && !signal.aborted) {
          // E.g. a binary that is neither run as root nor SUID root.
          const detail = lastContainerlabError(stderr.join("\n")) ?? `exit status ${exit.code}`;
          throw new LabBackendError(`containerlab events failed: ${detail}`, 500);
        }
      } finally {
        command.kill();
      }
    }
    return readJsonLines<LabEvent>(lines());
  }

  async dispose(): Promise<void> {
    // Child processes outlive their parent, so stop event streams explicitly.
    for (const command of this.eventCommands) command.kill();
    this.eventCommands.clear();
    this.terminals.dispose();
    await Promise.all([this.capture.dispose(), this.access.dispose()]);
  }
}

interface RepositoryRef {
  name: string;
  cloneUrl: string;
  branch?: string;
  subPath?: string;
}

/** GitHub and GitLab repository URLs (also `owner/repo`), as clab-api-server accepts them. */
export function parseRepositoryUrl(raw: string): RepositoryRef {
  const value = raw.trim();
  const shortForm = /^([\w.-]+)\/([\w.-]+)$/.exec(value);
  if (shortForm) {
    const name = shortForm[2].replace(/\.git$/, "");
    return { name: sanitize(name), cloneUrl: `https://github.com/${shortForm[1]}/${name}.git` };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LabBackendError("Only GitHub and GitLab repository URLs can be imported.", 400);
  }
  if (!/(^|\.)(github\.com|gitlab\.com)$/i.test(url.hostname)) {
    throw new LabBackendError("Only GitHub and GitLab repository URLs can be imported.", 400);
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const treeIndex = segments.findIndex((segment) => segment === "tree" || segment === "blob");
  const repositorySegments = (treeIndex >= 0 ? segments.slice(0, treeIndex) : segments).filter(
    (segment) => segment !== "-"
  );
  if (repositorySegments.length < 2) {
    throw new LabBackendError("The URL does not name a repository.", 400);
  }
  const name = repositorySegments[repositorySegments.length - 1].replace(/\.git$/, "");
  const ref: RepositoryRef = {
    name: sanitize(name),
    cloneUrl: `${url.protocol}//${url.host}/${repositorySegments.join("/").replace(/\.git$/, "")}.git`
  };
  if (treeIndex >= 0 && segments[treeIndex + 1]) {
    ref.branch = segments[treeIndex + 1];
    const subPath = segments.slice(treeIndex + 2).join("/");
    if (subPath) ref.subPath = subPath;
  }
  return ref;
}

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
}
