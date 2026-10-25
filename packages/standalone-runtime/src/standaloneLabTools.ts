// Lab tools of the web and desktop apps: validate, Mermaid/Graphviz exports,
// the Clos generator and sharing options.
import type { TopologyRef } from "@containerlab/clab-ui/session";
import {
  defaultClosDraft,
  promptForGenerateTopology,
  promptForOptionSelection,
  promptForShareOptions,
  runtimeUiActions,
  showShareLinks,
  showValidationResult,
  type EndpointSelectionOption,
  type ShareLink,
  type ShareOptionsResult
} from "@containerlab/clab-ui/workspace/state";

import {
  createTopologyFile,
  fetchBackendFeatures,
  generateGraphExport,
  generateTopology,
  validateTopology,
  type GraphExportFormat,
  type MermaidDirection,
  type ShareToolResponse
} from "./runtimeApi";
import { safeFilename } from "./standaloneHostShared";
import { triggerTextDownload, type ShareActionKind } from "./standaloneExplorerActions";

interface LabToolTarget {
  endpointId?: string;
  sessionId?: string;
  topologyRef: TopologyRef;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function validateTopologyFlow(target: LabToolTarget): Promise<void> {
  const { labName } = target.topologyRef;
  try {
    runtimeUiActions.notify(`Validating ${labName}...`, "info");
    const result = await validateTopology(target);
    if (result.valid) {
      runtimeUiActions.notify(
        `${labName} is valid: ${result.nodes} nodes, ${result.links} links.`,
        "success"
      );
      return;
    }
    await showValidationResult({
      labName,
      valid: false,
      details: result.error?.trim() || "containerlab rejected the topology."
    });
  } catch (error) {
    runtimeUiActions.notify(errorMessage(error), "error");
  }
}

const MERMAID_DIRECTIONS: Array<{ value: MermaidDirection; label: string }> = [
  { value: "TD", label: "Top down" },
  { value: "LR", label: "Left to right" },
  { value: "BT", label: "Bottom up" },
  { value: "RL", label: "Right to left" }
];

const GRAPH_EXPORTS: Record<GraphExportFormat, { label: string; mimeType: string }> = {
  mermaid: { label: "Mermaid", mimeType: "text/vnd.mermaid" },
  dot: { label: "Graphviz", mimeType: "text/vnd.graphviz" }
};

/** `containerlab graph --mermaid|--dot`, downloaded as a file. */
export async function exportGraphFlow(target: LabToolTarget, format: GraphExportFormat): Promise<void> {
  const { label, mimeType } = GRAPH_EXPORTS[format];
  let direction: MermaidDirection | undefined;
  if (format === "mermaid") {
    const picked = await promptForOptionSelection({
      title: "Export Graph (Mermaid)",
      message: "Choose the direction of the flowchart.",
      label: "Direction",
      confirmLabel: "Export",
      options: MERMAID_DIRECTIONS,
      preferredValue: "TD"
    });
    if (!picked) return;
    direction = MERMAID_DIRECTIONS.find((option) => option.value === picked)?.value;
  }
  try {
    runtimeUiActions.notify(`Generating the ${label} graph...`, "info");
    const response = await generateGraphExport({ ...target, format, direction });
    const fallbackName = `${target.topologyRef.labName}.${format === "mermaid" ? "mermaid" : "dot"}`;
    triggerTextDownload(safeFilename(response.fileName || fallbackName), response.content, mimeType);
    runtimeUiActions.notify(`Exported the ${label} graph of ${target.topologyRef.labName}.`, "success");
  } catch (error) {
    runtimeUiActions.notify(errorMessage(error), "error");
  }
}

/**
 * Asks for the options of an sshx or GoTTY share. Undefined when cancelled;
 * options the lab host cannot apply are not offered.
 */
export async function promptShareToolOptions(input: {
  kind: ShareActionKind;
  action: "attach" | "reattach";
  labName: string;
  endpointId?: string;
}): Promise<ShareOptionsResult | undefined> {
  const features = await fetchBackendFeatures(input.endpointId).catch(() => undefined);
  return promptForShareOptions({
    tool: input.kind,
    action: input.action,
    labName: input.labName,
    readersAvailable: features?.sshxReaders === true,
    credentialsAvailable: features?.gottyOptions === true
  });
}

/** The links of a started share, with the GoTTY sign-in or the read-only link. */
export async function showShareResult(
  kind: ShareActionKind,
  payload: ShareToolResponse,
  link: string,
  requested: ShareOptionsResult
): Promise<void> {
  const links: ShareLink[] = [
    {
      label: kind === "sshx" ? "Shared terminal" : "Web terminal",
      url: link,
      description: kind === "sshx" ? "Anyone with this link can type in the terminals." : undefined
    }
  ];
  if (payload.readOnlyLink) {
    links.push({
      label: "Read-only link",
      url: payload.readOnlyLink,
      description: "Viewers can watch but not type."
    });
  }
  let note: string | undefined;
  if (kind === "gotty") {
    note = requested.username
      ? `Sign in as ${requested.username} with the password you set.`
      : `Sign in as ${payload.username ?? "admin"} with password admin.`;
  } else if (requested.enableReaders === true && !payload.readOnlyLink) {
    note = "sshx did not return a read-only link for this session.";
  }
  await navigator.clipboard.writeText(link).catch(() => {});
  await showShareLinks({
    title: kind === "sshx" ? "sshx session started" : "GoTTY session started",
    links,
    note
  });
}

/** The Clos wizard: generate on the chosen lab host, save the file and open it. */
export async function generateTopologyFlow(input: {
  endpointOptions: EndpointSelectionOption[];
  defaultEndpointId?: string;
  directory: string;
  onCreated: (topologyRef: TopologyRef, endpointId: string) => Promise<void>;
}): Promise<void> {
  const result = await promptForGenerateTopology({
    endpointOptions: input.endpointOptions,
    defaultEndpointId: input.defaultEndpointId,
    initialDraft: defaultClosDraft(input.directory)
  });
  const endpointId = result?.endpointId ?? input.defaultEndpointId;
  if (!result || !endpointId) return;
  try {
    runtimeUiActions.notify(`Generating ${result.request.name}...`, "info");
    const generated = await generateTopology({ endpointId, request: result.request });
    if (!generated.topologyYaml) {
      throw new Error("containerlab returned no topology.");
    }
    const created = await createTopologyFile({
      endpointId,
      fileName: result.fileName,
      content: generated.topologyYaml
    });
    runtimeUiActions.notify(`Created ${result.fileName}.`, "success");
    await input.onCreated(created.topologyRef, endpointId);
  } catch (error) {
    runtimeUiActions.notify(errorMessage(error), "error");
  }
}
