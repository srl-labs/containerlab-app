import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type Docker from "dockerode";

import type {
  DrawioGenerateResponse,
  FcliCommandResponse,
  HealthMetricsResponse,
  NetemInterfaceInfo,
  NetemResetRequest,
  NetemSetRequest,
  NetemShowResponse,
  NodeBrowserPort,
  RuntimeImageActionResponse,
  RuntimeImagesResponse,
  RuntimeImageSummary,
  ShareToolAction,
  ShareToolResponse,
  VersionCheckResponse,
  VersionResponse
} from "../contract/dto.ts";
import { LabBackendError } from "../contract/errors.ts";
import type { ResolvedLocalOptions } from "./options.ts";
import { containerlabCommand, runChecked, runCommand, stripAnsi } from "./process.ts";

const STARTED_AT = new Date();

function clab(options: ResolvedLocalOptions, args: string[], timeoutMs = 120_000) {
  const [file, commandArgs] = containerlabCommand(options, args);
  return runChecked(file, commandArgs, { env: options.env, timeoutMs, cwd: options.workspaceRoot });
}

/** `containerlab version`, in clab-api-server's `versionInfo` layout. */
export async function containerlabVersion(options: ResolvedLocalOptions): Promise<VersionResponse> {
  const result = await clab(options, ["version"], 15_000);
  const fields = new Map<string, string>();
  for (const line of stripAnsi(result.stdout).split("\n")) {
    const match = /^\s*([a-z. ]+):\s*(.+)$/i.exec(line);
    if (match) fields.set(match[1].trim().toLowerCase(), match[2].trim());
  }
  const version = fields.get("version") ?? "unknown";
  const [major, minor, patch] = version.split(".");
  const notes = major && minor ? `https://containerlab.dev/rn/${major}.${minor}/${patch && patch !== "0" ? `#${major}${minor}${patch}` : ""}` : "";
  return {
    versionInfo: [
      `version: ${version}`,
      `commit: ${fields.get("commit") ?? "unknown"}`,
      `date: ${fields.get("date") ?? "unknown"}`,
      "github: https://github.com/srl-labs/containerlab",
      `release notes: ${fields.get("rel. notes") ?? notes}`
    ].join("\n")
  };
}

export async function containerlabVersionCheck(options: ResolvedLocalOptions): Promise<VersionCheckResponse> {
  try {
    const result = await clab(options, ["version", "check"], 20_000);
    const lines = stripAnsi(`${result.stderr}\n${result.stdout}`)
      .split("\n")
      .map((line) => line.replace(/^\s*│\s?/, "").trim())
      .filter((line) => line && !/^\d{2}:\d{2}:\d{2} /.test(line) && !line.endsWith("="));
    return { checkResult: lines.join("\n") || "You are on the latest version" };
  } catch {
    return { checkResult: "Failed fetching latest version information" };
  }
}

function formatUptime(milliseconds: number): string {
  let seconds = Math.floor(milliseconds / 1000);
  const parts: string[] = [];
  for (const [unit, size] of [
    ["d", 86_400],
    ["h", 3600],
    ["m", 60]
  ] as const) {
    const value = Math.floor(seconds / size);
    seconds -= value * size;
    if (value > 0 || parts.length > 0) parts.push(`${value}${unit}`);
  }
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    const times = cpu.times;
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

/** CPU, memory and disk usage of this machine, like the API's health metrics. */
export async function hostMetrics(version: string): Promise<HealthMetricsResponse> {
  const before = cpuTimes();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const after = cpuTimes();
  const totalDelta = after.total - before.total;
  const usagePercent = totalDelta > 0 ? (1 - (after.idle - before.idle) / totalDelta) * 100 : 0;
  const [loadAvg1, loadAvg5, loadAvg15] = os.loadavg();
  const totalMem = os.totalmem();
  const availableMem = os.freemem();
  const metrics: HealthMetricsResponse["metrics"] = {
    cpu: { usagePercent, numCPU: os.cpus().length, loadAvg1, loadAvg5, loadAvg15 },
    mem: {
      totalMem,
      usedMem: totalMem - availableMem,
      availableMem,
      usagePercent: totalMem > 0 ? ((totalMem - availableMem) / totalMem) * 100 : 0
    }
  };
  try {
    const stat = await fs.statfs("/");
    const totalDisk = stat.blocks * stat.bsize;
    const freeDisk = stat.bavail * stat.bsize;
    metrics.disk = {
      path: "/",
      totalDisk,
      usedDisk: totalDisk - freeDisk,
      freeDisk,
      usagePercent: totalDisk > 0 ? ((totalDisk - freeDisk) / totalDisk) * 100 : 0
    };
  } catch {
    // No disk metrics.
  }
  return {
    serverInfo: {
      version,
      uptime: formatUptime(os.uptime() * 1000),
      startTime: STARTED_AT.toISOString()
    },
    metrics
  };
}

interface NetemCliEntry {
  interface?: string;
  delay?: string;
  jitter?: string;
  packet_loss?: number;
  rate?: number;
  corruption?: number;
}

export async function netemShow(options: ResolvedLocalOptions, containerName: string): Promise<NetemShowResponse> {
  const result = await clab(options, ["tools", "-r", options.runtime, "netem", "show", "-n", containerName, "-f", "json"]);
  const parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf("{"))) as Record<string, NetemCliEntry[] | null>;
  const response: NetemShowResponse = {};
  for (const [name, entries] of Object.entries(parsed)) {
    response[name] = (entries ?? []).map((entry): NetemInterfaceInfo => ({
      interface: entry.interface ?? "",
      delay: entry.delay ?? "",
      jitter: entry.jitter ?? "",
      packet_loss: entry.packet_loss ?? 0,
      rate: entry.rate ?? 0,
      ...(entry.corruption ? { corruption: entry.corruption } : {})
    }));
  }
  return response;
}

export async function netemSet(options: ResolvedLocalOptions, request: NetemSetRequest): Promise<void> {
  const args = ["tools", "-r", options.runtime, "netem", "set", "-n", request.containerName, "-i", request.interface];
  if (request.delay) args.push("--delay", request.delay);
  if (request.jitter) args.push("--jitter", request.jitter);
  if (request.loss !== undefined) args.push("--loss", String(request.loss));
  if (request.rate !== undefined) args.push("--rate", String(request.rate));
  if (request.corruption !== undefined) args.push("--corruption", String(request.corruption));
  await clab(options, args);
}

export async function netemReset(options: ResolvedLocalOptions, request: NetemResetRequest): Promise<void> {
  await clab(options, ["tools", "-r", options.runtime, "netem", "reset", "-n", request.containerName, "-i", request.interface]);
}

export async function saveLab(options: ResolvedLocalOptions, topology: string, nodeFilter?: string) {
  const args = ["save", "-r", options.runtime, "-t", topology];
  if (nodeFilter) args.push("--node-filter", nodeFilter);
  const result = await clab(options, args, 10 * 60_000);
  const labName = path.basename(topology).replace(/\.clab\.ya?ml$/i, "");
  return {
    message: `Configuration save command executed successfully for lab '${labName}'.`,
    output: stripAnsi(`${result.stderr}${result.stdout}`).trim() || "Configuration saved"
  };
}

export async function drawioGraph(
  options: ResolvedLocalOptions,
  topology: string,
  layout: "horizontal" | "vertical" | "interactive",
  theme = "nokia_modern"
): Promise<DrawioGenerateResponse> {
  const effectiveLayout = layout === "interactive" ? "horizontal" : layout;
  const result = await clab(
    options,
    ["graph", "-r", options.runtime, "--drawio", "--drawio-args", `--theme ${theme} --layout ${effectiveLayout}`, "-t", topology],
    5 * 60_000
  );
  const drawioFile = topology.replace(/\.ya?ml$/i, "") + ".drawio";
  const output = stripAnsi(`${result.stderr}${result.stdout}`).trim();
  return {
    fileName: path.basename(drawioFile),
    content: await fs.readFile(drawioFile, "utf8"),
    layout: effectiveLayout,
    ...(layout === "interactive"
      ? { message: "Interactive draw.io mode needs a terminal; generated horizontal layout." }
      : {}),
    ...(output ? { output } : {})
  };
}

export async function fcli(
  options: ResolvedLocalOptions,
  topology: string,
  mgmtNetwork: string,
  command: string
): Promise<FcliCommandResponse> {
  const args = [
    "run",
    "--pull",
    "always",
    "--rm",
    "--network",
    mgmtNetwork,
    "-v",
    "/etc/hosts:/etc/hosts:ro",
    "-v",
    `${topology}:/topo.yml`,
    "ghcr.io/srl-labs/nornir-srl:latest",
    "-t",
    "/topo.yml",
    ...command.split(/\s+/).filter(Boolean)
  ];
  const result = await runCommand(options.runtime, args, { env: options.env, timeoutMs: 10 * 60_000 });
  const output = `${result.stdout}${result.stderr}`.trim();
  if (result.code !== 0) {
    throw new LabBackendError(`command ${options.runtime} run failed: exit status ${result.code}: ${output}`, 500);
  }
  return { command, output };
}

export async function shareTool(
  options: ResolvedLocalOptions,
  tool: "sshx" | "gotty",
  labName: string,
  action: ShareToolAction,
  port?: number
): Promise<ShareToolResponse> {
  const args = ["tools", tool, action, "-l", labName];
  if (tool === "gotty" && action !== "detach") args.push("--port", String(port ?? 8080));
  const result = await clab(options, args, 5 * 60_000);
  const output = stripAnsi(`${result.stdout}\n${result.stderr}`).trim();
  // Like clab-api-server, the link may still say HOST_IP; hosts know which name reaches them.
  const link = /https?:\/\/[^\s"'<>]+/.exec(output)?.[0];
  return {
    message: `${tool.toUpperCase()} ${action} completed for lab '${labName}'.`,
    ...(link ? { link } : {}),
    ...(output ? { output } : {})
  };
}

/** `containerlab tools sshx|gotty list -f json`: the running share sessions. */
export async function listShareSessions(options: ResolvedLocalOptions, tool: "sshx" | "gotty"): Promise<unknown[]> {
  const result = await clab(options, ["tools", tool, "list", "-f", "json"], 60_000);
  const start = result.stdout.indexOf("[");
  if (start < 0) return [];
  const parsed = JSON.parse(result.stdout.slice(start)) as unknown;
  return Array.isArray(parsed) ? parsed : [];
}

interface DockerImageRow {
  ID: string;
  Repository: string;
  Tag: string;
  Digest: string;
  CreatedAt?: string;
  CreatedSince?: string;
  Size?: string;
  VirtualSize?: string;
}

export async function listImages(options: ResolvedLocalOptions): Promise<RuntimeImagesResponse> {
  const result = await runChecked(
    options.runtime,
    ["image", "ls", "--all", "--digests", "--no-trunc", "--format", "{{json .}}"],
    { env: options.env, timeoutMs: 60_000 }
  );
  const images = new Map<string, RuntimeImageSummary>();
  for (const line of result.stdout.split("\n")) {
    if (!line.trim()) continue;
    let row: DockerImageRow;
    try {
      row = JSON.parse(line) as DockerImageRow;
    } catch {
      continue;
    }
    const image = images.get(row.ID) ?? {
      id: row.ID,
      shortId: row.ID.replace(/^sha256:/, "").slice(0, 12),
      repoTags: [],
      repoDigests: [],
      createdAt: row.CreatedAt ?? row.CreatedSince,
      size: row.Size,
      virtualSize: row.VirtualSize ?? row.Size
    };
    if (row.Repository !== "<none>" && row.Tag !== "<none>") {
      const tag = `${row.Repository}:${row.Tag}`;
      if (!image.repoTags.includes(tag)) image.repoTags.push(tag);
    }
    if (row.Repository !== "<none>" && row.Digest && row.Digest !== "<none>") {
      const digest = `${row.Repository}@${row.Digest}`;
      if (!image.repoDigests.includes(digest)) image.repoDigests.push(digest);
    }
    images.set(row.ID, image);
  }
  return { runtime: options.runtime, images: [...images.values()] };
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);
}

function validateImageReference(reference: string): string {
  const trimmed = reference.trim();
  if (!trimmed || trimmed.length > 512 || /\s/.test(trimmed) || hasControlCharacter(trimmed)) {
    throw new LabBackendError("Invalid image reference", 400);
  }
  return trimmed;
}

export async function pullImage(options: ResolvedLocalOptions, image: string): Promise<RuntimeImageActionResponse> {
  const reference = validateImageReference(image);
  const result = await runChecked(options.runtime, ["pull", reference], { env: options.env, timeoutMs: 30 * 60_000 });
  return { success: true, image: reference, message: "Image pulled", output: stripAnsi(result.stdout).trim() };
}

export async function removeImage(
  options: ResolvedLocalOptions,
  image: string,
  force: boolean
): Promise<RuntimeImageActionResponse> {
  const reference = validateImageReference(image);
  const result = await runChecked(
    options.runtime,
    ["image", "rm", ...(force ? ["--force"] : []), reference],
    { env: options.env, timeoutMs: 5 * 60_000 }
  );
  return { success: true, image: reference, message: "Image removed", output: stripAnsi(result.stdout).trim() };
}

export async function containerLogs(options: ResolvedLocalOptions, containerName: string, tail = "all") {
  const result = await runChecked(
    options.runtime,
    ["logs", "--tail", tail, "--timestamps", containerName],
    { env: options.env, timeoutMs: 60_000 }
  );
  return { containerName, logs: result.stdout };
}

const PORT_DESCRIPTIONS: Record<number, string> = {
  22: "SSH",
  23: "Telnet",
  25: "SMTP",
  53: "DNS",
  80: "HTTP",
  443: "HTTPS",
  1880: "Node-RED",
  3000: "Grafana",
  5432: "PostgreSQL",
  5601: "Kibana",
  8080: "Web Server",
  8443: "HTTPS (Alt)",
  9000: "Web Server",
  9090: "Prometheus",
  9200: "Elasticsearch"
};

/** The ports a node publishes on this machine, for "open in browser". */
export async function browserPorts(docker: Docker, containerName: string): Promise<NodeBrowserPort[]> {
  const details = await docker.getContainer(containerName).inspect();
  const seen = new Set<string>();
  const ports: NodeBrowserPort[] = [];
  for (const [containerPort, bindings] of Object.entries(details.NetworkSettings.Ports ?? {})) {
    const [portText, protocol = "tcp"] = containerPort.split("/");
    for (const binding of bindings ?? []) {
      const hostPort = Number(binding.HostPort);
      if (!Number.isInteger(hostPort) || hostPort <= 0) continue;
      const key = `${binding.HostIp}:${hostPort}/${protocol}->${portText}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const port = Number(portText);
      ports.push({
        hostIp: binding.HostIp,
        hostPort,
        containerPort: port,
        protocol,
        ...(PORT_DESCRIPTIONS[port] ? { description: PORT_DESCRIPTIONS[port] } : {})
      });
    }
  }
  return ports.sort(
    (left, right) =>
      left.hostPort - right.hostPort ||
      left.containerPort - right.containerPort ||
      (left.protocol ?? "").localeCompare(right.protocol ?? "")
  );
}
