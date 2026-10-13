// Explorer snapshots shaped the way each host builds them, listing the harness topology files.
import {
  EXPLORER_SECTION_LABELS,
  type ExplorerAction,
  type ExplorerNode,
  type ExplorerSectionSnapshot,
  type ExplorerSnapshotMessage,
  type ExplorerUiState
} from "../../src/explorer/shared/explorer/types";

export type HarnessHostLayout = "vscode" | "web" | "sandbox";

export const HARNESS_HOST_LAYOUTS: readonly HarnessHostLayout[] = ["vscode", "web", "sandbox"];

const OPEN_FILE_PREFIX = "open-file:";
const OPEN_LINK_PREFIX = "open-link:";
const ENDPOINT = { id: "endpoint:local", label: "localhost", url: "127.0.0.1:8080" };
const RUNNING_GROUP_ID = "endpoint-section:running:local";
const LOCAL_GROUP_ID = "endpoint-section:local:local";
const FILE_ROOT_ID = "file-root:local";
const FILE_FOLDER_ID = "file:/topologies";
const SANDBOX_WORKSPACE_LABEL = "Local workspace";
const HELP_LINKS = [
  { label: "Containerlab Documentation", url: "https://containerlab.dev/" },
  { label: "VS Code Extension Documentation", url: "https://containerlab.dev/manual/vsc-extension/" },
  { label: "Browse Labs on GitHub (srl-labs)", url: "https://github.com/srl-labs/" },
  {
    label: 'Find more labs tagged with "clab-topo"',
    url: "https://github.com/search?q=topic%3Aclab-topo++fork%3Atrue&type=repositories"
  },
  { label: "Join our Discord server", url: "https://discord.gg/vAyddtaEV9" },
  { label: "Download cshargextcap Wireshark plugin", url: "https://github.com/siemens/cshargextcap/releases/latest" }
];

/** Web and sandbox open the endpoint and its undeployed labs by default; VS Code has nothing nested. */
export const HARNESS_EXPLORER_UI_STATE: ExplorerUiState = {
  expandedBySection: {
    runningLabs: [ENDPOINT.id, LOCAL_GROUP_ID],
    fileExplorer: [FILE_ROOT_ID, FILE_FOLDER_ID]
  }
};

export type HarnessExplorerAction = { kind: "openFile"; path: string } | { kind: "openLink"; url: string };

export function parseHarnessExplorerAction(actionRef: string): HarnessExplorerAction | undefined {
  if (actionRef.startsWith(OPEN_FILE_PREFIX)) {
    return { kind: "openFile", path: actionRef.slice(OPEN_FILE_PREFIX.length) };
  }
  if (actionRef.startsWith(OPEN_LINK_PREFIX)) {
    return { kind: "openLink", url: actionRef.slice(OPEN_LINK_PREFIX.length) };
  }
  return undefined;
}

function basename(filePath: string): string {
  return filePath.split("/").filter(Boolean).at(-1) ?? filePath;
}

function folderName(filePath: string): string {
  return filePath.split("/").filter(Boolean).at(-2) ?? "";
}

function action(actionRef: string, label: string, commandId: string): ExplorerAction {
  return { id: actionRef, actionRef, label, commandId };
}

function openTopology(filePath: string): ExplorerAction {
  return action(`${OPEN_FILE_PREFIX}${filePath}`, "Open TopoViewer", "containerlab.lab.graph.topoViewer");
}

function group(id: string, label: string, contextValue: string, children: ExplorerNode[]): ExplorerNode {
  return { id, label, contextValue, hasChildren: children.length > 0, actions: [], children };
}

function lab(filePath: string, description: string): ExplorerNode {
  const open = openTopology(filePath);
  return {
    id: `lab:${filePath}`,
    label: basename(filePath),
    description,
    contextValue: "containerlabLabUndeployed",
    primaryAction: open,
    actions: [open],
    children: []
  };
}

function file(filePath: string): ExplorerNode {
  const open = filePath.endsWith(".clab.yml") ? openTopology(filePath) : undefined;
  return {
    id: `file:${filePath}`,
    label: basename(filePath),
    contextValue: open ? "containerlabFileTopology" : "containerlabFile",
    primaryAction: open,
    actions: open ? [open] : [],
    children: []
  };
}

function helpLink(label: string, url: string): ExplorerNode {
  return {
    id: `help:${url}`,
    label,
    tooltip: url,
    primaryAction: action(`${OPEN_LINK_PREFIX}${url}`, label, "containerlab.openLink"),
    actions: [],
    children: []
  };
}

function section(
  id: ExplorerSectionSnapshot["id"],
  label: string,
  nodes: ExplorerNode[],
  appearance?: ExplorerSectionSnapshot["appearance"]
): ExplorerSectionSnapshot {
  return { id, label, count: nodes.length, nodes, toolbarActions: [], ...(appearance ? { appearance } : {}) };
}

function fileExplorer(rootLabel: string, filePaths: string[]): ExplorerSectionSnapshot {
  const folder = group(FILE_FOLDER_ID, "topologies", "containerlabFileFolder", filePaths.map(file));
  return section("fileExplorer", EXPLORER_SECTION_LABELS.fileExplorer, [
    group(FILE_ROOT_ID, rootLabel, "containerlabFileExplorerRoot", [folder])
  ]);
}

function sectionsFor(layout: HarnessHostLayout, filePaths: string[]): ExplorerSectionSnapshot[] {
  const labPaths = filePaths.filter((filePath) => filePath.endsWith(".clab.yml"));
  if (layout === "vscode") {
    return [
      section("runningLabs", EXPLORER_SECTION_LABELS.runningLabs, []),
      section(
        "localLabs",
        EXPLORER_SECTION_LABELS.localLabs,
        labPaths.map((filePath) => lab(filePath, folderName(filePath)))
      ),
      section(
        "helpFeedback",
        EXPLORER_SECTION_LABELS.helpFeedback,
        HELP_LINKS.map((link) => helpLink(link.label, link.url))
      )
    ];
  }
  if (layout === "sandbox") {
    // Nothing can run in the sandbox, so its single workspace lists the topology files directly.
    return [
      section("runningLabs", "Endpoints", labPaths.map((filePath) => lab(filePath, filePath)), "bareTree"),
      fileExplorer(SANDBOX_WORKSPACE_LABEL, filePaths)
    ];
  }
  const endpoint: ExplorerNode = {
    ...group(ENDPOINT.id, ENDPOINT.label, "containerlabEndpoint", [
      group(RUNNING_GROUP_ID, "Running Labs", "containerlabEndpointSectionRunning", []),
      group(
        LOCAL_GROUP_ID,
        "Undeployed Labs",
        "containerlabEndpointSectionLocal",
        labPaths.map((filePath) => lab(filePath, filePath))
      )
    ]),
    description: ENDPOINT.url,
    state: "connected",
    statusIndicator: "green"
  };
  return [section("runningLabs", "Endpoints", [endpoint], "bareTree"), fileExplorer(ENDPOINT.label, filePaths)];
}

export function buildHarnessExplorerSnapshot(
  layout: HarnessHostLayout,
  filePaths: string[],
  filterText: string
): ExplorerSnapshotMessage {
  const query = filterText.toLowerCase();
  const visiblePaths = filePaths
    .filter((filePath) => basename(filePath).toLowerCase().includes(query))
    .sort((left, right) => left.localeCompare(right));
  return { command: "snapshot", filterText, sections: sectionsFor(layout, visiblePaths) };
}
