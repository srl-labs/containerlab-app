// Requests and checks of the lab operation dialogs.
import {
  isValidLabelFilter,
  type LabExecRequest,
  type LabSaveConfigsRequest,
  type LabSnapshotSaveRequest
} from "../../../host/labOperations";
import { isValidLabActionPath } from "../../../host/lifecycleOptions";

export type ExecTarget = "nodes" | "label";

export interface ExecForm {
  target: ExecTarget;
  nodeNames: string[];
  labels: string[];
  command: string;
}

const DURATION_PATTERN = /^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/;

/** Why the exec form cannot run yet, if it cannot. */
export function execFormError(form: ExecForm): string | undefined {
  if (form.command.trim() === "") return "Enter a command";
  if (form.target === "label") {
    if (form.labels.length === 0) return "Add at least one label";
    const invalid = form.labels.find((label) => !isValidLabelFilter(label));
    if (invalid !== undefined) return `Use key=value: ${invalid}`;
  }
  return undefined;
}

export function buildExecRequest(form: ExecForm): LabExecRequest {
  const command = form.command.trim();
  if (form.target === "label") return { command, labels: form.labels };
  return form.nodeNames.length > 0 ? { command, nodeNames: form.nodeNames } : { command };
}

/** The containerlab command line of an exec request, for the preview. */
export function execCommandLine(request: LabExecRequest): string {
  const parts = ["containerlab", "exec", "--cmd", JSON.stringify(request.command)];
  for (const label of request.labels ?? []) parts.push("--label", label);
  if (request.nodeNames && request.nodeNames.length > 0) {
    parts.push(`# on ${request.nodeNames.join(", ")}`);
  }
  return parts.join(" ");
}

export function directoryError(value: string, required: boolean): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return required ? "Enter a directory" : undefined;
  return isValidLabActionPath(trimmed) ? undefined : "Remove control characters";
}

export function timeoutError(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" || DURATION_PATTERN.test(trimmed) ? undefined : "Use a duration such as 5m";
}

export function buildSnapshotRequest(form: {
  nodeNames: string[];
  outputDir: string;
  timeout: string;
}): LabSnapshotSaveRequest {
  const request: LabSnapshotSaveRequest = {};
  if (form.nodeNames.length > 0) request.nodeNames = form.nodeNames;
  if (form.outputDir.trim()) request.outputDir = form.outputDir.trim();
  if (form.timeout.trim()) request.timeout = form.timeout.trim();
  return request;
}

export function buildSaveConfigsRequest(form: {
  nodeNames: string[];
  copy: boolean;
  copyDir: string;
}): LabSaveConfigsRequest {
  const request: LabSaveConfigsRequest = {};
  if (form.nodeNames.length > 0) request.nodeNames = form.nodeNames;
  if (form.copy && form.copyDir.trim()) request.copyDir = form.copyDir.trim();
  return request;
}

/** `1.5 GiB`, like containerlab prints snapshot sizes. */
export function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

/** A few runtime fields worth showing before the full record. */
export function containerSummary(details: Record<string, unknown>): Array<[string, string]> {
  const pick = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = details[key];
      if (typeof value === "string" && value.length > 0) return value;
      if (typeof value === "number") return String(value);
    }
    return undefined;
  };
  const labels = details.Labels;
  const kind =
    typeof labels === "object" && labels !== null
      ? (labels as Record<string, unknown>)["clab-node-kind"]
      : undefined;
  const rows: Array<[string, string | undefined]> = [
    ["State", pick("State", "state")],
    ["Status", pick("Status", "status")],
    ["Kind", typeof kind === "string" ? kind : undefined],
    ["Image", pick("Image", "image")],
    ["ID", pick("ShortID", "ID", "Id")],
    ["PID", pick("Pid")]
  ];
  return rows.filter((row): row is [string, string] => row[1] !== undefined);
}
