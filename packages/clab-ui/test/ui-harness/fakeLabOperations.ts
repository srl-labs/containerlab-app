// Pretend exec, VM snapshots, config save and inspect details for the harness.
import {
  NO_LAB_OPERATIONS,
  parseExecResponse,
  parseInspectDetails,
  summarizeSnapshots,
  type ClabUiLabOperationsHost,
  type LabOperationSupport,
  type LabSnapshotNodeResult
} from "../../src/host/labOperations";
import { parseNodeLocations } from "../../src/host/kubernetes";

import {
  containerRuntimeFeatures,
  effectiveSupport,
  type LabHostInfo
} from "../../src/host/labHostSupport";

import { readTopology, type DesiredLab } from "./fakeLab";

/** Kinds the fake treats as vrnetlab VMs; snapshots skip the rest. */
const VM_KINDS = new Set(["nokia_sros", "cisco_xrv9k", "juniper_vjunosrouter", "nokia_srsim"]);

const ALL_SUPPORTED: LabOperationSupport = {
  execByLabel: true,
  snapshotSave: true,
  deployRestore: true,
  saveCopy: true,
  inspectDetails: true
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

/**
 * The fake lab host: Docker, unless a spec sets `window.__CLAB_UI_HARNESS_LAB_HOST__`
 * to `"c9s"` (a Kubernetes cluster on this machine) to see what the view hides there.
 */
function harnessLabHost(): LabHostInfo {
  const stub = (window as unknown as { __CLAB_UI_HARNESS_LAB_HOST__?: unknown }).__CLAB_UI_HARNESS_LAB_HOST__;
  const c9s = stub === "c9s";
  const capabilities = {
    sshAccess: false,
    deployFromUrl: true,
    importFromUrl: true,
    edgesharkManagement: true,
    wiresharkVnc: true,
    healthMetrics: true,
    sharedWorkspace: false,
    tailscaleStatus: false,
    captureTickets: false
  };
  const features = {
    validate: true,
    graphMermaid: true,
    graphDot: true,
    sshxReaders: !c9s,
    gottyOptions: !c9s,
    nodeStats: !c9s,
    terminalResume: true,
    ...containerRuntimeFeatures(!c9s),
    manifestExport: c9s,
    c9sDeployOptions: c9s,
    interfaceInspect: true,
    captureStream: c9s,
    captureVnc: false
  };
  return {
    profile: c9s
      ? { runtime: "c9s", kubeContext: "kind-harness", namespaceMode: "per-lab", persistence: true }
      : { runtime: "docker" },
    support: effectiveSupport(capabilities, features)
  };
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

    async hostInfo() {
      return harnessLabHost();
    },

    async nodeLocations() {
      if (harnessLabHost().profile.runtime !== "c9s") return [];
      const current = lab();
      return parseNodeLocations(
        [...current.nodes.keys()].map((node) => ({
          name: `${current.labName}-${node}`,
          lab_name: current.labName,
          namespace: `c9s-${current.labName}`,
          pod: `${current.labName}-${node}-6d9f7c-x2k4q`,
          container: `node-${node}-1a2b3c`,
          exposed_ports: [{ exposePort: 22, destinationPort: 22, protocol: "TCP" }]
        }))
      );
    },

    async captureInterfaces() {
      if (!harnessLabHost().support.captureStream) return [];
      deps.record({ command: "labOperation", operation: "captureInterfaces" });
      // Every end of a link between nodes, with the other end as its peer.
      return lab().links.flatMap((link) => {
        const [left, right] = link.split(" -- ").map((end) => {
          const index = end.indexOf(":");
          return { node: end.slice(0, index), iface: end.slice(index + 1) };
        });
        if (!left || !right || !lab().nodes.has(left.node) || !lab().nodes.has(right.node)) return [];
        return [
          { node: left.node, interface: left.iface, peerNode: right.node, peerInterface: right.iface },
          { node: right.node, interface: right.iface, peerNode: left.node, peerInterface: left.iface }
        ];
      });
    },

    async exportManifests() {
      deps.record({ command: "labOperation", operation: "exportManifests" });
      const current = lab();
      return {
        yaml: `apiVersion: c9s.run/v1alpha1\nkind: Topology\nmetadata:\n  name: ${current.labName}\n  namespace: c9s-${current.labName}\n`
      };
    },

    async validate() {
      deps.record({ command: "labOperation", operation: "validate" });
      // A spec sets `window.__CLAB_UI_HARNESS_VALIDATE_ERROR__` to what containerlab rejects.
      const error = (window as unknown as { __CLAB_UI_HARNESS_VALIDATE_ERROR__?: unknown })
        .__CLAB_UI_HARNESS_VALIDATE_ERROR__;
      return typeof error === "string" ? { valid: false, error } : { valid: true };
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
    }
  };
}
