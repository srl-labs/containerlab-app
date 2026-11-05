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
import { parseNodeLocations } from "../../src/host/kubernetes";
import type { LabSettings } from "../../src/host/lifecycleOptions";

import {
  containerRuntimeFeatures,
  effectiveSupport,
  type LabHostInfo
} from "../../src/host/labHostSupport";
import { parseLabHostIdentity } from "../../src/host/labHostIdentity";

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

/** Lab hosts to look at by URL, e.g. `/index.html?labHost=k8s`. */
const LAB_HOST_PRESETS: Record<string, unknown> = {
  local: { id: "local", label: "This computer", kind: "this-computer", runtime: "docker", status: "connected" },
  podman: { id: "local", label: "This computer", kind: "this-computer", runtime: "podman", status: "connected" },
  k8s: { id: "c9s", label: "kind-c9s-app", kind: "cluster", runtime: "c9s", status: "connected" },
  api: { id: "api", label: "lab-server:8090", kind: "server", runtime: "docker", status: "connected" },
  "api-k8s": { id: "api", label: "lab-server:8090", kind: "server", runtime: "c9s", status: "connected" },
  "signed-out": { id: "api", label: "lab-server:8090", kind: "server", status: "saved" }
};

/**
 * The fake lab host: Docker, unless a spec sets `window.__CLAB_UI_HARNESS_LAB_HOST__`
 * to `"c9s"` (a Kubernetes cluster on this machine) to see what the view hides there.
 * `window.__CLAB_UI_HARNESS_LAB_HOST_IDENTITY__` names the host in the toolbar,
 * or the page's `?labHost=` picks one of `LAB_HOST_PRESETS`.
 */
function harnessLabHost(): LabHostInfo {
  const stub = (window as unknown as { __CLAB_UI_HARNESS_LAB_HOST__?: unknown }).__CLAB_UI_HARNESS_LAB_HOST__;
  const preset = new URLSearchParams(window.location.search).get("labHost") ?? "";
  const c9s = stub === "c9s" || preset === "k8s" || preset === "api-k8s";
  const identity = parseLabHostIdentity(
    (window as unknown as { __CLAB_UI_HARNESS_LAB_HOST_IDENTITY__?: unknown }).__CLAB_UI_HARNESS_LAB_HOST_IDENTITY__ ??
      LAB_HOST_PRESETS[preset]
  );
  const capabilities = {
    sshAccess: false,
    deployFromUrl: true,
    importFromUrl: true,
    edgesharkManagement: true,
    wiresharkVnc: true,
    healthMetrics: true,
    sharedWorkspace: false,
    tailscaleStatus: false
  };
  const features = {
    validate: true,
    graphMermaid: true,
    graphDot: true,
    sshxReaders: !c9s,
    gottyOptions: !c9s,
    nodeStats: !c9s,
    terminalResume: true,
    lifecycleTimeout: true,
    ...containerRuntimeFeatures(!c9s),
    manifestExport: c9s,
    c9sDeployOptions: c9s,
    interfaceInspect: true,
    captureStream: c9s,
    captureVnc: false
  };
  return {
    profile: c9s
      ? { runtime: "c9s", kubeContext: "kind-harness", namespaceMode: "per-lab", persistence: true, defaultTimeout: "10m" }
      : { runtime: "docker", defaultTimeout: "2m" },
    support: effectiveSupport(capabilities, features),
    ...(identity ? { host: identity } : {})
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
  let labSettings: LabSettings | undefined;

  return {
    async support() {
      return harnessSupport();
    },

    async labSettings() {
      return labSettings;
    },

    async saveLabSettings(settings) {
      deps.record({ command: "labOperation", operation: "saveLabSettings", settings });
      labSettings = settings;
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
    },

    /** Describes the script as it was given; a path or script mentioning "foreign" is someone else's. */
    async describeHostScript(source) {
      deps.record({ command: "labOperation", operation: "describeHostScript", request: source });
      await delay();
      const text = source.scriptPath ?? source.script ?? "";
      return {
        kind: source.scriptPath ? "file" : "inline",
        ...(source.scriptPath ? { resolvedPath: `/lab/${source.scriptPath}` } : {}),
        sha256: `sha-${text}`,
        size: text.length,
        foreign: text.includes("foreign"),
        content: text,
        truncated: false,
        trustKey: `trust-${text}`
      };
    },

    /**
     * Echoes the script; a script or path that mentions "fail" exits with 1, and
     * one that mentions "slow" runs until it is stopped.
     */
    async runHostScript(request, options) {
      deps.record({ command: "labOperation", operation: "runHostScript", request });
      await delay();
      const source = request.scriptPath ?? request.script ?? "";
      if (source.includes("slow")) {
        await new Promise<void>((resolve) => {
          if (options?.signal?.aborted) resolve();
          options?.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
        return { exitCode: null, stdout: "", stderr: "", timedOut: false, cancelled: true, durationMs: 150 };
      }
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
