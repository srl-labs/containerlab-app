import fs from "node:fs/promises";
import path from "node:path";

import Docker from "dockerode";

import type {
  LabBackend,
  LabBackendCapabilities,
  LabEvent,
  LabEventStreamOptions,
  LabLifecycleAction,
  LabTarget,
  LifecycleRunOptions,
  TerminalCreateOptions,
  TopologyFileSystem,
  TopologyFilesOptions,
  WiresharkVncRequest
} from "../contract/backend.ts";
import type {
  CaptureTarget,
  ImportTopologyFromUrlResponse,
  InspectAllLabsResponse,
  InspectContainerInfo,
  NetemResetRequest,
  NetemSetRequest,
  NodeLifecycleAction,
  ShareToolAction,
  SSHAccessResponse
} from "../contract/dto.ts";
import { LabBackendError } from "../contract/errors.ts";
import { readJsonLines } from "../ndjson.ts";
import { LocalCapture } from "./capture.ts";
import { inspectField, inspectLabs } from "./inspect.ts";
import { LocalLifecycle } from "./lifecycle.ts";
import { resolveLocalOptions, type LocalLabBackendOptions, type ResolvedLocalOptions } from "./options.ts";
import { containerlabCommand, runChecked, runCommand, spawnLines } from "./process.ts";
import { LocalTerminals } from "./terminals.ts";
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
  sharedWorkspace: false
};

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

  async save(labName: string, options: { nodeFilter?: string } = {}) {
    return tools.saveLab(this.options, await this.requireRunningTopology(labName), options.nodeFilter);
  }

  async graphDrawio(
    labName: string,
    options: { layout: "horizontal" | "vertical" | "interactive"; theme?: string }
  ) {
    const topology =
      (await this.runningTopologyFile(labName)) ??
      (await this.resolveTopology(labName, `${labName}/${labName}.clab.yml`));
    return tools.drawioGraph(this.options, topology, options.layout, options.theme);
  }

  async fcli(labName: string, command: string) {
    const containers = await this.inspectLab(labName);
    const network = inspectField(containers[0], "mgmt_network") || "clab";
    return tools.fcli(this.options, await this.requireRunningTopology(labName), network, command);
  }

  shareTool(tool: "sshx" | "gotty", labName: string, action: ShareToolAction, options: { port?: number } = {}) {
    return tools.shareTool(this.options, tool, labName, action, options.port);
  }

  async nodeAction(labName: string, containerName: string, action: NodeLifecycleAction): Promise<void> {
    const container = await this.container(labName, containerName);
    if (action === "pause" || action === "unpause") {
      await runChecked(this.options.runtime, [action, container.name], { env: this.options.env });
      return;
    }
    const topology = await this.requireRunningTopology(labName);
    const nodeName = inspectField(container, "nodeName") || container.name;
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

  async nodeBrowserPorts(labName: string, containerName: string) {
    const container = await this.container(labName, containerName);
    return {
      nodeName: inspectField(container, "nodeName") || container.name,
      containerName: container.name,
      ports: await tools.browserPorts(this.docker, container.name)
    };
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
    return discoverTopologies(this.fs.paths);
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
      repository.subPath?.match(/\.clab\.ya?ml$/i)
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
