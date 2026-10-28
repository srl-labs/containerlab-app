// Form state of the lifecycle options dialog and the request it produces.
import type { TopoViewerLifecycleAction } from "../../../host/contracts";
import {
  isValidVarsFile,
  labLifecycleOptionFields,
  labLifecycleCliFlags,
  normalizeLabLifecycleOptions,
  type LabLifecycleOptionField,
  type LabLifecycleOptionKind,
  type C9sExposeType,
  type LabLifecycleOptions,
  type LabRuntimeKind,
  type LabSnapshotRestore
} from "../../../host/lifecycleOptions";

export interface LifecycleOptionsForm {
  kind: LabLifecycleOptionKind;
  /** The lab host's runtime: it decides which options containerlab takes. */
  runtime: LabRuntimeKind;
  cleanup: boolean;
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

export function createLifecycleOptionsForm(
  kind: LabLifecycleOptionKind,
  runtime: LabRuntimeKind = "docker"
): LifecycleOptionsForm {
  return {
    kind,
    runtime,
    cleanup: false,
    nodeFilter: [],
    maxWorkers: "",
    skipPostDeploy: false,
    skipLabdirAcl: false,
    exportTemplate: "",
    graceful: false,
    keepMgmtNet: false,
    varsFile: "",
    restoreSnapshots: false,
    restoreAll: "snapshots",
    restore: [],
    namespace: "",
    exposeType: "",
    noPersistence: false,
    imagePullSecret: "",
    noTopologyCR: false
  };
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
 * The request of the form and what keeps it from running, with snapshot
 * restore left out on lab hosts that cannot do it.
 */
export function buildLifecycleRun(
  form: LifecycleOptionsForm,
  canRestoreSnapshots: boolean
): { request: LifecycleOptionsRequest; snapshotError: string | undefined } {
  const effective = canRestoreSnapshots ? form : { ...form, restoreSnapshots: false };
  return { request: buildLifecycleOptionsRequest(effective), snapshotError: restoreError(effective) };
}
