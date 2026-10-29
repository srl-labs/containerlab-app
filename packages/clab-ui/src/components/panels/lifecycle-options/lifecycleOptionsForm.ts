// Form state of the lifecycle options dialog and the request it produces.
import type { TopoViewerLifecycleAction } from "../../../host/contracts";
import {
  isValidLifecycleTimeout,
  isValidVarsFile,
  labLifecycleOptionFields,
  labLifecycleCliFlags,
  labSettingsFromOptions,
  normalizeLabLifecycleOptions,
  type LabLifecycleOptionField,
  type LabLifecycleOptionKind,
  type C9sExposeType,
  type LabLifecycleOptions,
  type LabRuntimeKind,
  type LabSettings,
  type LabSnapshotRestore
} from "../../../host/lifecycleOptions";

export interface LifecycleOptionsForm {
  kind: LabLifecycleOptionKind;
  /** The lab host's runtime: it decides which options containerlab takes. */
  runtime: LabRuntimeKind;
  cleanup: boolean;
  /** containerlab's `--timeout`, e.g. `30m`; empty uses containerlab's default. */
  timeout: string;
  nodeFilter: string[];
  maxWorkers: string;
  skipPostDeploy: boolean;
  skipLabdirAcl: boolean;
  exportTemplate: string;
  graceful: boolean;
  keepMgmtNet: boolean;
  varsFile: string;
  /** Deploy only: boot VM nodes from saved snapshots. */
  restoreSnapshots: boolean;
  /** Directory with `<node>.tar` files; empty restores only the nodes listed in `restore`. */
  restoreAll: string;
  restore: LabSnapshotRestore[];
  /** c9s: the lab's namespace; empty uses the host's. */
  namespace: string;
  /** c9s: empty uses the host's default. */
  exposeType: "" | C9sExposeType;
  noPersistence: boolean;
  imagePullSecret: string;
  noTopologyCR: boolean;
}

export interface LifecycleOptionsRequest {
  action: TopoViewerLifecycleAction;
  options?: LabLifecycleOptions;
  /** The equivalent containerlab command line, for the preview. */
  command: string;
}

/** A form for an action, filled in from the lab's settings where it has them. */
export function createLifecycleOptionsForm(
  kind: LabLifecycleOptionKind,
  runtime: LabRuntimeKind = "docker",
  settings?: LabSettings
): LifecycleOptionsForm {
  return {
    kind,
    runtime,
    cleanup: false,
    timeout: settings?.timeout ?? "",
    nodeFilter: [],
    maxWorkers: settings?.maxWorkers !== undefined ? String(settings.maxWorkers) : "",
    skipPostDeploy: settings?.skipPostDeploy === true,
    skipLabdirAcl: settings?.skipLabdirAcl === true,
    exportTemplate: settings?.exportTemplate ?? "",
    graceful: false,
    keepMgmtNet: false,
    varsFile: settings?.varsFile ?? "",
    restoreSnapshots: false,
    restoreAll: "snapshots",
    restore: [],
    namespace: settings?.namespace ?? "",
    exposeType: settings?.exposeType ?? "",
    noPersistence: settings?.noPersistence === true,
    imagePullSecret: settings?.imagePullSecret ?? "",
    noTopologyCR: settings?.noTopologyCR === true
  };
}

/** containerlab's `--timeout` default: lab runtimes such as c9s wait longer for images. */
export function defaultTimeout(runtime: LabRuntimeKind): string {
  return runtime === "c9s" ? "10m" : "2m";
}

export function lifecycleKindTakes(
  kind: LabLifecycleOptionKind,
  field: LabLifecycleOptionField,
  runtime: LabRuntimeKind = "docker"
): boolean {
  return labLifecycleOptionFields(kind, runtime).includes(field);
}

/** containerlab refuses `destroy --cleanup` together with a node filter. */
export function isCleanupBlocked(form: LifecycleOptionsForm): boolean {
  return form.kind === "destroy" && form.nodeFilter.length > 0;
}

/** Problem with the max workers field, if any. Empty means no limit. */
export function maxWorkersError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed > 0 ? undefined : "Enter a whole number above 0";
}

/** Problem with the timeout field, if any. Empty means containerlab's default. */
export function timeoutError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "" || isValidLifecycleTimeout(trimmed)) return undefined;
  return "Enter a duration such as 30m or 1h30m";
}

/** Problem with the variables file field, if any. Empty means the default file. */
export function varsFileError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "" || isValidVarsFile(trimmed)) return undefined;
  return "Enter a path relative to the topology file";
}

const ACTIONS: Record<LabLifecycleOptionKind, [TopoViewerLifecycleAction, TopoViewerLifecycleAction]> =
  {
    deploy: ["deployLab", "deployLabCleanup"],
    redeploy: ["redeployLab", "redeployLabCleanup"],
    destroy: ["destroyLab", "destroyLabCleanup"]
  };

export function buildLifecycleOptionsRequest(form: LifecycleOptionsForm): LifecycleOptionsRequest {
  const cleanup = form.cleanup && !isCleanupBlocked(form);
  const maxWorkers = form.maxWorkers.trim() === "" ? undefined : Number(form.maxWorkers.trim());
  const options = normalizeLabLifecycleOptions(form.kind, {
    timeout: form.timeout,
    nodeFilter: form.nodeFilter,
    maxWorkers,
    skipPostDeploy: form.skipPostDeploy,
    skipLabdirAcl: form.skipLabdirAcl,
    exportTemplate: form.exportTemplate,
    graceful: form.graceful,
    keepMgmtNet: form.keepMgmtNet,
    varsFile: form.varsFile,
    ...(form.restoreSnapshots ? { restoreAll: form.restoreAll, restore: form.restore } : {}),
    namespace: form.namespace,
    ...(form.exposeType ? { exposeType: form.exposeType } : {}),
    noPersistence: form.noPersistence,
    imagePullSecret: form.imagePullSecret,
    noTopologyCR: form.noTopologyCR
  }, form.runtime);
  const [plainAction, cleanupAction] = ACTIONS[form.kind];
  const runtimeFlags = form.runtime === "docker" ? [] : ["-r", form.runtime];
  const command = ["containerlab", form.kind, ...runtimeFlags, ...(cleanup ? ["-c"] : []), ...labLifecycleCliFlags(options)]
    .join(" ");
  return {
    action: cleanup ? cleanupAction : plainAction,
    ...(options ? { options } : {}),
    command
  };
}

/** A restore that is switched on but names neither a directory nor a node file. */
export function restoreError(form: LifecycleOptionsForm): string | undefined {
  if (form.kind !== "deploy" || !form.restoreSnapshots) return undefined;
  const hasNodeFiles = form.restore.some((entry) => entry.node.trim() && entry.path.trim());
  return form.restoreAll.trim() || hasNodeFiles ? undefined : "Enter a directory or add a node";
}

/**
 * The form as a lab host takes it: snapshot restore and the timeout left out
 * on lab hosts that cannot do them.
 */
export function formForHost(
  form: LifecycleOptionsForm,
  host: { canRestoreSnapshots: boolean; canSetTimeout: boolean }
): LifecycleOptionsForm {
  return {
    ...form,
    ...(host.canRestoreSnapshots ? {} : { restoreSnapshots: false }),
    ...(host.canSetTimeout ? {} : { timeout: "" })
  };
}

/**
 * The request of the form and what keeps it from running, with snapshot
 * restore and the timeout left out on lab hosts that cannot do them.
 */
export function buildLifecycleRun(
  form: LifecycleOptionsForm,
  canRestoreSnapshots: boolean,
  canSetTimeout = true
): { request: LifecycleOptionsRequest; snapshotError: string | undefined } {
  const effective = formForHost(form, { canRestoreSnapshots, canSetTimeout });
  return { request: buildLifecycleOptionsRequest(effective), snapshotError: restoreError(effective) };
}

/**
 * The lab settings a form holds: its deploy options without those of one run
 * (node filter, snapshot restore, cleanup). Undefined when it holds none.
 */
export function labSettingsFromForm(form: LifecycleOptionsForm): LabSettings | undefined {
  return labSettingsFromOptions(
    buildLifecycleOptionsRequest({ ...form, kind: "deploy", cleanup: false, nodeFilter: [], restoreSnapshots: false })
      .options
  );
}
