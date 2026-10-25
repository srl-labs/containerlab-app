import { isRecord } from "../core/utilities/typeHelpers";

/**
 * Extra containerlab options for deploy, redeploy and destroy.
 *
 * Every field maps to a containerlab flag and to the matching clab-api-server
 * query parameter. Not every action takes every flag; see
 * `LAB_LIFECYCLE_OPTION_FIELDS`.
 */
export interface LabLifecycleOptions {
  /** Only act on these nodes (`--node-filter`). */
  nodeFilter?: string[];
  /** Limit the number of parallel workers (`--max-workers`). */
  maxWorkers?: number;
  /** Skip post-deploy actions (`--skip-post-deploy`). */
  skipPostDeploy?: boolean;
  /** Skip the lab directory extended ACLs (`--skip-labdir-acl`). */
  skipLabdirAcl?: boolean;
  /** Template file for the topology data export (`--export-template`). */
  exportTemplate?: string;
  /** Stop containers before removing them (`--graceful`). */
  graceful?: boolean;
  /** Keep the management network (`--keep-mgmt-net`). */
  keepMgmtNet?: boolean;
  /**
   * Template variables file, relative to the topology file (`--vars`).
   * Without it containerlab uses `<topology>_vars.yml` next to the topology.
   */
  varsFile?: string;
}

export type LabLifecycleOptionKind = "deploy" | "redeploy" | "destroy";
export type LabLifecycleOptionField = keyof LabLifecycleOptions;

/**
 * Options each action accepts, following containerlab and clab-api-server:
 * redeploy has no node filter, and the API does not take `maxWorkers` on destroy.
 */
export const LAB_LIFECYCLE_OPTION_FIELDS: Record<
  LabLifecycleOptionKind,
  readonly LabLifecycleOptionField[]
> = {
  deploy: ["nodeFilter", "maxWorkers", "skipPostDeploy", "skipLabdirAcl", "exportTemplate", "varsFile"],
  redeploy: [
    "maxWorkers",
    "skipPostDeploy",
    "skipLabdirAcl",
    "exportTemplate",
    "graceful",
    "keepMgmtNet",
    "varsFile"
  ],
  destroy: ["nodeFilter", "graceful", "keepMgmtNet", "varsFile"]
};

const NODE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const EXPORT_TEMPLATE_PATTERN = /^[A-Za-z0-9_./~-]+$/;
const VARS_FILE_PATTERN = /^[A-Za-z0-9_./@+-]+$/;
const BOOLEAN_FIELDS = ["skipPostDeploy", "skipLabdirAcl", "graceful", "keepMgmtNet"] as const;

export function isValidLifecycleNodeName(name: string): boolean {
  return NODE_NAME_PATTERN.test(name);
}

export function isValidExportTemplate(template: string): boolean {
  return EXPORT_TEMPLATE_PATTERN.test(template) && !template.includes("..");
}

function readNodeFilter(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .filter((name): name is string => typeof name === "string")
    .map((name) => name.trim())
    .filter((name) => isValidLifecycleNodeName(name));
  const unique = Array.from(new Set(names));
  return unique.length > 0 ? unique : undefined;
}

/** A vars file path relative to the topology file, e.g. `lab.clab_vars.prod.yml`. */
export function isValidVarsFile(file: string): boolean {
  return VARS_FILE_PATTERN.test(file) && !file.startsWith("/");
}

function readVarsFile(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const file = value.trim();
  return file.length > 0 && isValidVarsFile(file) ? file : undefined;
}

function readMaxWorkers(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readExportTemplate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const template = value.trim();
  return template.length > 0 && isValidExportTemplate(template) ? template : undefined;
}

/**
 * Keep the options that the action accepts and that are well formed; drop the rest.
 * Returns undefined when nothing is left, so callers can tell "no options" apart.
 */
export function normalizeLabLifecycleOptions(
  kind: LabLifecycleOptionKind,
  value: unknown
): LabLifecycleOptions | undefined {
  if (!isRecord(value)) return undefined;
  const raw = value;
  const allowed = new Set<LabLifecycleOptionField>(LAB_LIFECYCLE_OPTION_FIELDS[kind]);
  const options: LabLifecycleOptions = {};

  if (allowed.has("nodeFilter")) {
    const nodeFilter = readNodeFilter(raw.nodeFilter);
    if (nodeFilter) options.nodeFilter = nodeFilter;
  }
  if (allowed.has("maxWorkers")) {
    const maxWorkers = readMaxWorkers(raw.maxWorkers);
    if (maxWorkers !== undefined) options.maxWorkers = maxWorkers;
  }
  if (allowed.has("exportTemplate")) {
    const exportTemplate = readExportTemplate(raw.exportTemplate);
    if (exportTemplate !== undefined) options.exportTemplate = exportTemplate;
  }
  for (const field of BOOLEAN_FIELDS) {
    if (allowed.has(field) && raw[field] === true) options[field] = true;
  }
  if (allowed.has("varsFile")) {
    const varsFile = readVarsFile(raw.varsFile);
    if (varsFile !== undefined) options.varsFile = varsFile;
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

/** containerlab CLI flags for the options, in a stable order. */
export function labLifecycleCliFlags(options: LabLifecycleOptions | undefined): string[] {
  if (!options) return [];
  const flags: string[] = [];
  if (options.nodeFilter && options.nodeFilter.length > 0) {
    flags.push("--node-filter", options.nodeFilter.join(","));
  }
  if (options.maxWorkers !== undefined) flags.push("--max-workers", String(options.maxWorkers));
  if (options.skipPostDeploy === true) flags.push("--skip-post-deploy");
  if (options.skipLabdirAcl === true) flags.push("--skip-labdir-acl");
  if (options.exportTemplate !== undefined) {
    flags.push("--export-template", options.exportTemplate);
  }
  if (options.graceful === true) flags.push("--graceful");
  if (options.keepMgmtNet === true) flags.push("--keep-mgmt-net");
  if (options.varsFile !== undefined) flags.push("--vars", options.varsFile);
  return flags;
}

/** clab-api-server query parameters for the options. */
export function labLifecycleQueryParams(
  options: LabLifecycleOptions | undefined
): Array<[string, string]> {
  if (!options) return [];
  const params: Array<[string, string]> = [];
  if (options.nodeFilter && options.nodeFilter.length > 0) {
    params.push(["nodeFilter", options.nodeFilter.join(",")]);
  }
  if (options.maxWorkers !== undefined) params.push(["maxWorkers", String(options.maxWorkers)]);
  if (options.skipPostDeploy === true) params.push(["skipPostDeploy", "true"]);
  if (options.skipLabdirAcl === true) params.push(["skipLabdirAcl", "true"]);
  if (options.exportTemplate !== undefined) params.push(["exportTemplate", options.exportTemplate]);
  if (options.graceful === true) params.push(["graceful", "true"]);
  if (options.keepMgmtNet === true) params.push(["keepMgmtNet", "true"]);
  if (options.varsFile !== undefined) params.push(["varsPath", options.varsFile]);
  return params;
}

/**
 * Destroying some nodes leaves the rest of the lab running, so hosts must not
 * treat it as the lab going away.
 */
export function isPartialDestroy(options: LabLifecycleOptions | undefined): boolean {
  return (options?.nodeFilter?.length ?? 0) > 0;
}
