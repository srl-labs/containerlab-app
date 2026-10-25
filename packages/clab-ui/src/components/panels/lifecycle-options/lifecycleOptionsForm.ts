// Form state of the lifecycle options dialog and the request it produces.
import type { TopoViewerLifecycleAction } from "../../../host/contracts";
import {
  LAB_LIFECYCLE_OPTION_FIELDS,
  isValidVarsFile,
  labLifecycleCliFlags,
  normalizeLabLifecycleOptions,
  type LabLifecycleOptionField,
  type LabLifecycleOptionKind,
  type LabLifecycleOptions
} from "../../../host/lifecycleOptions";

export interface LifecycleOptionsForm {
  kind: LabLifecycleOptionKind;
  cleanup: boolean;
  nodeFilter: string[];
  maxWorkers: string;
  skipPostDeploy: boolean;
  skipLabdirAcl: boolean;
  exportTemplate: string;
  graceful: boolean;
  keepMgmtNet: boolean;
  varsFile: string;
}

export interface LifecycleOptionsRequest {
  action: TopoViewerLifecycleAction;
  options?: LabLifecycleOptions;
  /** The equivalent containerlab command line, for the preview. */
  command: string;
}

export function createLifecycleOptionsForm(kind: LabLifecycleOptionKind): LifecycleOptionsForm {
  return {
    kind,
    cleanup: false,
    nodeFilter: [],
    maxWorkers: "",
    skipPostDeploy: false,
    skipLabdirAcl: false,
    exportTemplate: "",
    graceful: false,
    keepMgmtNet: false,
    varsFile: ""
  };
}

export function lifecycleKindTakes(
  kind: LabLifecycleOptionKind,
  field: LabLifecycleOptionField
): boolean {
  return LAB_LIFECYCLE_OPTION_FIELDS[kind].includes(field);
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
    varsFile: form.varsFile
  });
  const [plainAction, cleanupAction] = ACTIONS[form.kind];
  const command = ["containerlab", form.kind, ...(cleanup ? ["-c"] : []), ...labLifecycleCliFlags(options)]
    .join(" ");
  return {
    action: cleanup ? cleanupAction : plainAction,
    ...(options ? { options } : {}),
    command
  };
}
