import fs from "node:fs/promises";
import path from "node:path";

import {
  isTopologyFileName,
  type LabExecRequest,
  type LabHostScriptRequest,
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
import { readJsonLines } from "../ndjson.ts";
import { LocalCapture } from "./capture.ts";
import { runLocalHostScript, streamLocalHostScript } from "./hostScripts.ts";
import { inspectField, inspectLabs } from "./inspect.ts";
import {
  localExec,
  localInspectDetails,
  localNodesAction,
  localOperationSupport,
  localSaveSnapshots,
  type LocalLabRef
} from "./labOperations.ts";
import { LocalLifecycle } from "./lifecycle.ts";
import { labStats } from "./stats.ts";
import { resolveLocalOptions, type LocalLabBackendOptions, type ResolvedLocalOptions } from "./options.ts";
import {
  containerlabCommand,
  runChecked,
  runCommand,
  spawnLines,
  type StreamingCommand
} from "./process.ts";
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

const LOCAL_FEATURES: LabBackendFeatures = {
  validate: true,
  graphMermaid: true,
  graphDot: true,
  sshxReaders: true,
  gottyOptions: true,
  nodeStats: true,
  terminalResume: true
};

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
  private readonly capture: LocalCapture;
  private support: Promise<LabOperationSupport> | undefined;
  /** Running `containerlab events` commands; they must not outlive the app. */
  private readonly eventCommands = new Set<StreamingCommand>();

  constructor(options: LocalLabBackendOptions = {}) {
    this.options = resolveLocalOptions(options);
    this.fs = new LocalWorkspace(this.options.workspaceRoot);
    const docker = () => this.docker;
    this.terminals = new LocalTerminals(docker, this.options.username);
    this.capture = new LocalCapture(this.options, docker);
    this.lifecycle = new LocalLifecycle({
      options: this.options,
      resolveTopology: (labName, rawPath) => this.resolveTopology(labName, rawPath),
      runningTopologyFile: (labName) => this.runningTopologyFile(labName),
      inspectLab: (labName) => this.inspectLab(labName)
    });
  }

  get scope(): string {
    return `local:${this.options.workspaceRoot}`;
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
    const containers = (await inspectLabs(this.docker, labName))[labName] ?? [];
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
    const version = await this.version().then(
      (response) => /version: (\S+)/.exec(response.versionInfo)?.[1] ?? "unknown",
      () => "unknown"
    );
    return tools.hostMetrics(version);
  }

  inspectAll(): Promise<InspectAllLabsResponse> {
    return inspectLabs(this.docker);
  }

  async inspectLab(labName: string) {
    const containers = (await inspectLabs(this.docker, labName))[labName];
    if (!containers || containers.length === 0) {
      throw new LabBackendError(`Lab '${labName}' not found.`, 404);
    }
    return containers;
  }

  async isLabRunning(labName: string): Promise<boolean> {
    return ((await inspectLabs(this.docker, labName))[labName]?.length ?? 0) > 0;
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
    return tools.saveLab(this.options, await this.labTopology(lab), options.nodeFilter, copyDir);
  }

  labOperationSupport(): Promise<LabOperationSupport> {
    this.support ??= this.version().then(
      (response) =>
        localOperationSupport(
          /version: (\S+)/.exec(response.versionInfo)?.[1],
          this.options.hostScripts
        ),
      () => localOperationSupport(undefined, this.options.hostScripts)
    );
    return this.support;
  }

  /** The running lab's topology file, or its name when containerlab has none. */
  private async labRef(lab: LabTarget): Promise<LocalLabRef> {
    try {
      return { topology: await this.labTopology(lab), labName: lab.labName };
    } catch (error) {
      if (lab.labName) return { labName: lab.labName };
      throw error;
    }
  }

  async exec(lab: LabTarget, request: LabExecRequest) {
    return localExec(this.options, await this.labRef(lab), request);
  }

  async nodesAction(lab: LabTarget, nodeNames: string[], action: TopoViewerNodesAction) {
    return localNodesAction(this.options, await this.labRef(lab), nodeNames, action);
  }

  async saveSnapshots(lab: LabTarget, request: LabSnapshotSaveRequest) {
    if (!(await this.labOperationSupport()).snapshotSave) {
      throw new LabBackendError("This containerlab cannot save VM snapshots; update it to 0.72 or later.", 501);
    }
    return localSaveSnapshots(this.options, await this.labTopology(lab), request);
  }

  async inspectLabDetails(lab: LabTarget) {
    return localInspectDetails(this.options, await this.labRef(lab));
  }

  async runHostScript(lab: LabTarget, request: LabHostScriptRequest) {
    return runLocalHostScript(this.options, await this.labRef(lab), request);
  }

  async streamHostScript(lab: LabTarget, request: LabHostScriptRequest) {
    return streamLocalHostScript(this.options, await this.labRef(lab), request);
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
    return LOCAL_FEATURES;
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

  /** `containerlab inspect interfaces`: the interfaces of one container. */
  async inspectInterfaces(topology: string, containerName: string): Promise<unknown[]> {
    const [file, args] = containerlabCommand(this.options, [
      "inspect",
      "interfaces",
      "-t",
      topology,
      "-f",
      "json",
      "-n",
      containerName
    ]);
    const result = await runChecked(file, args, { env: this.options.env, timeoutMs: 10_000 });
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
      await runChecked(this.options.runtime, [action, container.name], { env: this.options.env });
      return;
    }
    const topology = await this.requireRunningTopology(labName);
    // Slot containers of a distributed node start and stop through their root node.
    const labels = await this.docker
      .getContainer(container.name)
      .inspect()
      .then((details) => details.Config.Labels ?? {})
      .catch((): Record<string, string> => ({}));
    const nodeName =
      labels["clab-root-node-name"] || inspectField(container, "nodeName") || container.name;
    const [file, args] = containerlabCommand(this.options, [
      action,
      "-r",
      this.options.runtime,
      "-t",
      topology,
      "-n",
      nodeName
    ]);
    await runChecked(file, args, { cwd: path.dirname(topology), env: this.options.env, timeoutMs: 10 * 60_000 });
  }

  async nodeLogs(labName: string, containerName: string, options: { tail?: string } = {}) {
    const container = await this.container(labName, containerName);
    return tools.containerLogs(this.options, container.name, options.tail ?? "all");
  }

  async streamNodeLogs(
    labName: string,
    containerName: string,
    options: NodeLogStreamOptions
  ): Promise<AsyncIterable<NodeLogLine>> {
    const container = await this.container(labName, containerName);
    const command = await spawnLines(
      this.options.runtime,
      ["logs", "--follow", "--tail", options.tail ?? "all", "--timestamps", container.name],
      { env: this.options.env, signal: options.signal }
    );
    // The runtime CLI writes the container's stderr to its own stderr.
    async function* lines(): AsyncGenerator<NodeLogLine> {
      try {
        for await (const output of command.lines) yield output;
      } finally {
        command.kill();
      }
    }
    return lines();
  }

  async streamLabStats(labName: string, options: LabStatsStreamOptions) {
    await this.inspectLab(labName);
    const interval = Math.min(20, Math.max(1, Math.round(options.intervalSeconds ?? 2)));
    return labStats(this.docker, labName, interval, options.signal);
  }

  async nodeBrowserPorts(labName: string, containerName: string) {
    const container = await this.container(labName, containerName);
    return {
      nodeName: inspectField(container, "nodeName") || container.name,
      containerName: container.name,
      ports: await tools.browserPorts(this.docker, container.name)
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
    return this.terminals.create(
      {
        labName,
        nodeName: inspectField(container, "nodeName") || container.name,
        containerId: inspectField(container, "container_id", "containerId") || container.name,
        kind: inspectField(container, "kind"),
        ipv4Address: inspectField(container, "ipv4_address", "ipv4Address")
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
    const topology = await this.runningTopologyFile(labName);
    const labDirectory = topology ? path.join(path.dirname(topology), `clab-${labName}`) : undefined;
    return this.capture.createVnc(labName, labDirectory, request.targets, request.theme);
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
      try {
        for await (const output of command.lines) {
          if (output.stream === "stdout") yield `${output.line}\n`;
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
    await this.capture.dispose();
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
