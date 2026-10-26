import { isRecord } from "../core/utilities/typeHelpers";

/**
 * Lab operations beyond the lifecycle that a lab host may lack, such as an
 * older clab-api-server or containerlab. Hosts hide what is false.
 */
export interface LabOperationSupport {
  /** `exec --label`: run a command on the nodes that carry a label. */
  execByLabel: boolean;
  /** `tools snapshot save`: save VM snapshots of vrnetlab nodes. */
  snapshotSave: boolean;
  /** `deploy --restore-all` and `--restore`. */
  deployRestore: boolean;
  /** `save --copy`: copy the saved configs to a directory. */
  saveCopy: boolean;
  /** `inspect --details`: everything the runtime knows about each container. */
  inspectDetails: boolean;
  /** Script buttons: shell scripts that run on the lab host itself. */
  hostScript: boolean;
}

export const NO_LAB_OPERATIONS: LabOperationSupport = {
  execByLabel: false,
  snapshotSave: false,
  deployRestore: false,
  saveCopy: false,
  inspectDetails: false,
  hostScript: false
};

/** `containerlab exec`: one command on chosen nodes, on nodes with labels, or on all nodes. */
export interface LabExecRequest {
  command: string;
  /** Topology node names; all nodes when empty. */
  nodeNames?: string[];
  /** `key=value` labels the nodes must all carry. */
  labels?: string[];
}

export interface LabExecNodeResult {
  container: string;
  node: string;
  returnCode: number;
  stdout: string;
  stderr: string;
}

export interface LabExecResult {
  results: LabExecNodeResult[];
}

export interface LabSnapshotSaveRequest {
  /** Topology node names; all VM nodes when empty. */
  nodeNames?: string[];
  /** Directory for `<node>.tar`; relative paths start at the topology directory. */
  outputDir?: string;
  /** Per-node timeout as a Go duration, e.g. `5m`. */
  timeout?: string;
}

export type LabSnapshotStatus = "success" | "failed" | "skipped";

export interface LabSnapshotNodeResult {
  node: string;
  status: LabSnapshotStatus;
  path?: string;
  sizeBytes?: number;
  durationMs?: number;
  error?: string;
  reason?: string;
}

export interface LabSnapshotSaveResult {
  outputDir: string;
  results: LabSnapshotNodeResult[];
  summary: string;
}

export interface LabSaveConfigsRequest {
  /** Topology node names; all nodes when empty. */
  nodeNames?: string[];
  /** Also copy the saved configs here (`save --copy`); relative paths start at the topology directory. */
  copyDir?: string;
}

export interface LabSaveConfigsResult {
  message: string;
  output: string;
  copyDir?: string;
}

export interface LabContainerDetails {
  container: string;
  node: string;
  details: Record<string, unknown>;
}

export interface LabInspectDetailsResult {
  containers: LabContainerDetails[];
}

/**
 * A script that runs on the lab host with bash, from the topology folder.
 * `scriptPath` wins over `script` when both are set.
 */
export interface LabHostScriptRequest {
  /** Script file; relative paths start at the topology folder. */
  scriptPath?: string;
  /** Script body, used when there is no path. */
  script?: string;
  /** Stops the script after this many seconds; unset means no limit. */
  timeoutSeconds?: number;
  /**
   * When set, the host also shows the output in its own terminal or output
   * view under this title. Lab hosts ignore it.
   */
  outputTitle?: string;
}

export interface LabHostScriptResult {
  /** Exit code; null when the script was stopped by a signal. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

/** What a streamed host script reports: output as it comes, then how it ended. */
export type LabHostScriptEvent =
  | { type: "output"; stream: "stdout" | "stderr"; text: string }
  | { type: "exit"; result: LabHostScriptResult };

/** Lab operations on the lab that is open in the topology view. */
export interface ClabUiLabOperationsHost {
  support(): Promise<LabOperationSupport>;
  exec(request: LabExecRequest): Promise<LabExecResult>;
  saveSnapshots(request: LabSnapshotSaveRequest): Promise<LabSnapshotSaveResult>;
  saveConfigs(request: LabSaveConfigsRequest): Promise<LabSaveConfigsResult>;
  inspectDetails(): Promise<LabInspectDetailsResult>;
  runHostScript(request: LabHostScriptRequest): Promise<LabHostScriptResult>;
}

export type LabOperationName = keyof ClabUiLabOperationsHost;

const LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}=[A-Za-z0-9._:/@+-]{1,256}$/;

/** A `key=value` label filter as containerlab and clab-api-server accept it. */
export function isValidLabelFilter(label: string): boolean {
  return LABEL_PATTERN.test(label);
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function numberField(record: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

/** containerlab embeds output that is valid JSON as JSON instead of a string. */
function outputText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

/**
 * The topology node a container belongs to: a known node whose name ends the
 * container name (the longest one), else the name without `clab-<lab>-`.
 */
export function nodeNameForContainer(
  container: string,
  knownNodes: readonly string[] = [],
  labName?: string
): string {
  if (knownNodes.includes(container)) return container;
  let best = "";
  for (const node of knownNodes) {
    if (container.endsWith(`-${node}`) && node.length > best.length) best = node;
  }
  if (best) return best;
  const prefix = labName !== undefined && labName !== "" ? `clab-${labName}-` : "";
  return prefix !== "" && container.startsWith(prefix) ? container.slice(prefix.length) : container;
}

function byNode<T extends { node: string; container?: string }>(left: T, right: T): number {
  return (
    left.node.localeCompare(right.node) || (left.container ?? "").localeCompare(right.container ?? "")
  );
}

export function parseLabOperationSupport(value: unknown): LabOperationSupport {
  if (!isRecord(value)) return { ...NO_LAB_OPERATIONS };
  return {
    execByLabel: value.execByLabel === true,
    snapshotSave: value.snapshotSave === true,
    deployRestore: value.deployRestore === true,
    saveCopy: value.saveCopy === true,
    inspectDetails: value.inspectDetails === true,
    hostScript: value.hostScript === true
  };
}

export function parseHostScriptResponse(value: unknown): LabHostScriptResult {
  if (!isRecord(value)) {
    return { exitCode: null, stdout: "", stderr: "", timedOut: false, durationMs: 0 };
  }
  const exitCode = numberField(value, "exitCode");
  return {
    exitCode: exitCode ?? null,
    stdout: stringField(value, "stdout") ?? "",
    stderr: stringField(value, "stderr") ?? "",
    timedOut: value.timedOut === true,
    durationMs: numberField(value, "durationMs") ?? 0
  };
}

/**
 * Exec results by container, as `containerlab exec --format json` and
 * clab-api-server return them, one entry per node.
 */
export function parseExecResponse(
  value: unknown,
  knownNodes: readonly string[] = [],
  labName?: string
): LabExecResult {
  if (!isRecord(value)) return { results: [] };
  const results: LabExecNodeResult[] = [];
  for (const [container, entries] of Object.entries(value)) {
    const list = Array.isArray(entries) ? entries : [entries];
    const records = list.filter(isRecord);
    if (records.length === 0) continue;
    const stdout = records.map((entry) => outputText(entry.stdout ?? entry.Stdout)).join("\n");
    const stderr = records.map((entry) => outputText(entry.stderr ?? entry.Stderr)).join("\n");
    const returnCode = records.reduce(
      (code, entry) => code || (numberField(entry, "return-code", "returnCode", "ReturnCode") ?? 0),
      0
    );
    results.push({
      container,
      node: nodeNameForContainer(container, knownNodes, labName),
      returnCode,
      stdout,
      stderr
    });
  }
  return { results: results.sort(byNode) };
}

function parseSnapshotStatus(value: unknown): LabSnapshotStatus {
  return value === "success" || value === "skipped" ? value : "failed";
}

export function parseSnapshotSaveResponse(value: unknown): LabSnapshotSaveResult {
  if (!isRecord(value)) return { outputDir: "", results: [], summary: "" };
  const results = (Array.isArray(value.results) ? value.results : [])
    .filter(isRecord)
    .map((entry): LabSnapshotNodeResult => {
      const result: LabSnapshotNodeResult = {
        node: stringField(entry, "node", "nodeName") ?? "",
        status: parseSnapshotStatus(entry.status)
      };
      const path = stringField(entry, "path");
      const sizeBytes = numberField(entry, "sizeBytes");
      const durationMs = numberField(entry, "durationMs");
      const error = stringField(entry, "error");
      const reason = stringField(entry, "reason");
      if (path !== undefined && path !== "") result.path = path;
      if (sizeBytes !== undefined) result.sizeBytes = sizeBytes;
      if (durationMs !== undefined) result.durationMs = durationMs;
      if (error !== undefined && error !== "") result.error = error;
      if (reason !== undefined && reason !== "") result.reason = reason;
      return result;
    })
    .filter((entry) => entry.node.length > 0)
    .sort(byNode);
  return {
    outputDir: stringField(value, "outputDir") ?? "",
    results,
    summary: stringField(value, "summary") ?? summarizeSnapshots(results)
  };
}

/** `2 succeeded, 0 failed, 1 skipped`, like containerlab prints it. */
export function summarizeSnapshots(results: readonly LabSnapshotNodeResult[]): string {
  const count = (status: LabSnapshotStatus) =>
    results.filter((result) => result.status === status).length;
  return `${count("success")} succeeded, ${count("failed")} failed, ${count("skipped")} skipped`;
}

export function parseSaveConfigsResponse(value: unknown): LabSaveConfigsResult {
  if (!isRecord(value)) return { message: "", output: "" };
  const result: LabSaveConfigsResult = {
    message: stringField(value, "message") ?? "",
    output: stringField(value, "output") ?? ""
  };
  const copyDir = stringField(value, "copyDir");
  if (copyDir !== undefined && copyDir !== "") result.copyDir = copyDir;
  return result;
}

function containerName(details: Record<string, unknown>): string {
  const names = details.Names ?? details.names;
  const first = Array.isArray(names) ? names.find((name) => typeof name === "string") : undefined;
  const name = typeof first === "string" ? first : stringField(details, "name", "Name") ?? "";
  return name.replace(/^\//, "");
}

function containerLabels(details: Record<string, unknown>): Record<string, unknown> {
  const labels = details.Labels ?? details.labels;
  return isRecord(labels) ? labels : {};
}

/**
 * `containerlab inspect --details` output: containers grouped by lab name,
 * or a plain list. Each keeps its full runtime record.
 */
export function parseInspectDetails(
  value: unknown,
  knownNodes: readonly string[] = []
): LabInspectDetailsResult {
  let entries: Array<[string | undefined, unknown]> = [];
  if (Array.isArray(value)) {
    entries = value.map((entry) => [undefined, entry]);
  } else if (isRecord(value)) {
    entries = Object.entries(value).flatMap(([labName, list]) =>
      Array.isArray(list) ? list.map((entry): [string, unknown] => [labName, entry]) : []
    );
  }
  const containers: LabContainerDetails[] = [];
  for (const [labName, entry] of entries) {
    if (!isRecord(entry)) continue;
    const container = containerName(entry);
    if (!container) continue;
    const labelNode = containerLabels(entry)["clab-node-name"];
    containers.push({
      container,
      node:
        typeof labelNode === "string" && labelNode.length > 0
          ? labelNode
          : nodeNameForContainer(container, knownNodes, labName),
      details: entry
    });
  }
  return { containers: containers.sort(byNode) };
}

/** Exec, snapshot saves and config saves wait on every node; give them time. */
const OPERATION_TIMEOUT_MS: Record<LabOperationName, number> = {
  support: 30_000,
  exec: 10 * 60_000,
  saveSnapshots: 60 * 60_000,
  saveConfigs: 15 * 60_000,
  inspectDetails: 2 * 60_000,
  runHostScript: 24 * 60 * 60_000
};

interface PendingLabOperation {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

/**
 * Lab operations over postMessage: the host answers each request with its raw
 * result (clab-api-server JSON), parsed here like every other host's result.
 */
export function createLabOperationsRequester(options: {
  postMessage: (message: unknown) => void;
  subscribe: (handler: (event: MessageEvent<unknown>) => void) => () => void;
  requestMessage: string;
  resultMessage: string;
  newId: () => string;
}): ClabUiLabOperationsHost {
  const { postMessage, subscribe, requestMessage, resultMessage, newId } = options;
  const pending = new Map<string, PendingLabOperation>();
  let listenerStarted = false;

  const ensureListener = (): void => {
    if (listenerStarted) return;
    subscribe((event) => {
      const message = event.data;
      if (!isRecord(message) || message.type !== resultMessage) return;
      const requestId = typeof message.requestId === "string" ? message.requestId : "";
      const request = pending.get(requestId);
      if (!request) return;
      clearTimeout(request.timeoutId);
      pending.delete(requestId);
      if (message.success === true) {
        request.resolve(message.result);
        return;
      }
      const error = typeof message.error === "string" && message.error ? message.error : "";
      request.reject(new Error(error || "The lab operation failed"));
    });
    listenerStarted = true;
  };

  const send = (operation: LabOperationName, request?: unknown): Promise<unknown> => {
    ensureListener();
    const requestId = newId();
    return new Promise<unknown>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!pending.delete(requestId)) return;
        reject(new Error("The lab operation timed out"));
      }, OPERATION_TIMEOUT_MS[operation]);
      pending.set(requestId, { resolve, reject, timeoutId });
      postMessage({
        command: requestMessage,
        requestId,
        operation,
        ...(request === undefined ? {} : { request })
      });
    });
  };

  return {
    support: async () => parseLabOperationSupport(await send("support")),
    exec: async (request) =>
      parseExecResponse(await send("exec", request), request.nodeNames ?? []),
    saveSnapshots: async (request) => parseSnapshotSaveResponse(await send("saveSnapshots", request)),
    saveConfigs: async (request) => parseSaveConfigsResponse(await send("saveConfigs", request)),
    inspectDetails: async () => parseInspectDetails(await send("inspectDetails")),
    runHostScript: async (request) =>
      parseHostScriptResponse(await send("runHostScript", request))
  };
}
