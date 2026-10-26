// Pretend exec, VM snapshots, config save, inspect details and host scripts for the harness.
import {
  NO_LAB_OPERATIONS,
  parseExecResponse,
  parseInspectDetails,
  summarizeSnapshots,
  type ClabUiLabOperationsHost,
  type LabOperationSupport,
  type LabSnapshotNodeResult
} from "../../src/host/labOperations";

import { readTopology, type DesiredLab } from "./fakeLab";

/** Kinds the fake treats as vrnetlab VMs; snapshots skip the rest. */
const VM_KINDS = new Set(["nokia_sros", "cisco_xrv9k", "juniper_vjunosrouter", "nokia_srsim"]);

const ALL_SUPPORTED: LabOperationSupport = {
  execByLabel: true,
  snapshotSave: true,
  deployRestore: true,
  saveCopy: true,
  inspectDetails: true,
  hostScript: true
};

/**
 * What the fake lab host supports: everything, unless a spec sets
 * `window.__CLAB_UI_HARNESS_LAB_OPERATIONS__` to a support object or to `"old"`.
 */
function harnessSupport(): LabOperationSupport {
  const stub = (window as unknown as { __CLAB_UI_HARNESS_LAB_OPERATIONS__?: unknown })
    .__CLAB_UI_HARNESS_LAB_OPERATIONS__;
  if (stub === "old") return NO_LAB_OPERATIONS;
  if (typeof stub === "object" && stub !== null) return { ...ALL_SUPPORTED, ...stub };
  return ALL_SUPPORTED;
}

function containerName(lab: DesiredLab, node: string): string {
  return `clab-${lab.labName}-${node}`;
}

/** `role=leaf` matches nodes named like `leaf*`; `clab-node-kind=<kind>` matches the kind. */
function matchesLabel(lab: DesiredLab, node: string, label: string): boolean {
  const [key, value = ""] = label.split("=");
  if (key === "clab-node-kind") return lab.nodes.get(node)?.kind === value;
  if (key === "clab-node-name") return node === value;
  if (key === "role") return node.startsWith(value);
  return false;
}

export function createFakeLabOperations(deps: {
  readYaml: () => string | undefined;
  record: (message: unknown) => void;
}): ClabUiLabOperationsHost {
  const lab = (): DesiredLab => {
    const yaml = deps.readYaml();
    if (yaml === undefined) throw new Error("No topology is open");
    return readTopology(yaml);
  };
  const delay = () => new Promise((resolve) => setTimeout(resolve, 150));

  return {
    async support() {
      return harnessSupport();
    },

    async exec(request) {
      deps.record({ command: "labOperation", operation: "exec", request });
      await delay();
      const current = lab();
      const names = [...current.nodes.keys()].filter(
        (node) =>
          (!request.nodeNames?.length || request.nodeNames.includes(node)) &&
          (request.labels ?? []).every((label) => matchesLabel(current, node, label))
      );
      const failed = request.command.includes("fail");
      const raw = Object.fromEntries(
        names.map((node) => [
          containerName(current, node),
          [
            {
              cmd: request.command.split(" "),
              "return-code": failed ? 1 : 0,
              stdout: failed ? "" : `${node}: ${request.command} ok`,
              stderr: failed ? `${node}: command failed` : ""
            }
          ]
        ])
      );
      return parseExecResponse(raw, [...current.nodes.keys()], current.labName);
    },

    async saveSnapshots(request) {
      deps.record({ command: "labOperation", operation: "saveSnapshots", request });
      await delay();
      const current = lab();
      const outputDir = request.outputDir ?? "snapshots";
      const results = [...current.nodes.entries()]
        .filter(([node]) => !request.nodeNames?.length || request.nodeNames.includes(node))
        .map(([node, desired]): LabSnapshotNodeResult =>
          VM_KINDS.has(desired.kind)
            ? { node, status: "success", path: `${outputDir}/${node}.tar`, sizeBytes: 1_610_612_736 }
            : { node, status: "skipped", reason: `not a vrnetlab node (kind=${desired.kind})` }
        );
      return { outputDir, results, summary: summarizeSnapshots(results) };
    },

    async saveConfigs(request) {
      deps.record({ command: "labOperation", operation: "saveConfigs", request });
      await delay();
      const nodes = request.nodeNames?.length ? request.nodeNames.join(", ") : "all nodes";
      return {
        message: `Configuration saved for ${nodes}.`,
        output: "",
        ...(request.copyDir ? { copyDir: request.copyDir } : {})
      };
    },

    async inspectDetails() {
      deps.record({ command: "labOperation", operation: "inspectDetails" });
      await delay();
      const current = lab();
      return parseInspectDetails({
        [current.labName]: [...current.nodes.entries()].map(([node, desired]) => ({
          Names: [containerName(current, node)],
          Image: desired.image,
          State: "running",
          Status: "Up 5 minutes",
          Labels: { "clab-node-name": node, "clab-node-kind": desired.kind, containerlab: current.labName }
        }))
      });
    },

    /** Echoes the script; a script or path that mentions "fail" exits with 1. */
    async runHostScript(request) {
      deps.record({ command: "labOperation", operation: "runHostScript", request });
      await delay();
      const source = request.scriptPath ?? request.script ?? "";
      const failed = source.includes("fail");
      return {
        exitCode: failed ? 1 : 0,
        stdout: failed ? "" : `ran ${source}`,
        stderr: failed ? `${source}: failed` : "",
        timedOut: false,
        durationMs: 150
      };
    }
  };
}
