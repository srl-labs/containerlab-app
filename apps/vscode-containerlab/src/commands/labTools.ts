// Validate a topology, export Mermaid / Graphviz graphs, and generate Clos topologies.
import * as path from "path";

import * as vscode from "vscode";
import type {
  ClosGeneratorInitialData,
  ClosGeneratorResult
} from "@containerlab/clab-ui/clos-generator";
import type {
  GraphExportFormat,
  LabBackend,
  MermaidDirection
} from "@srl-labs/containerlab-lab-backend";

import { ClabLabTreeNode, onConnection } from "../treeView/common";
import { outputChannel } from "../globals";
import { getSelectedLabNode } from "../utils/utils";
import {
  backendFor,
  connectionOf,
  getConnections,
  getLocalBackend,
  labNameForPath,
  labPathOf,
  labUri,
  pickConnection,
  remoteUri,
  resolveLab
} from "../backend/labBackends";
import { LOCAL_CONNECTION, isThisComputer, type LabConnection } from "../backend/connections";
import { CLOS_GENERATOR_PANEL, createPanelWebviewHtml } from "../webviews/shared/webviewPanels";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function labForNode(node: ClabLabTreeNode | vscode.Uri | undefined) {
  const selected = await getSelectedLabNode(node);
  if (!selected?.labPath.absolute) {
    vscode.window.showErrorMessage("Select a topology file or lab first.");
    return undefined;
  }
  const labPath = selected.labPath.absolute;
  const labName = selected.name ?? labNameForPath(labPath);
  return { labPath, labName, lab: await resolveLab(labPath, labName, selected.connectionId) };
}

/** `containerlab validate` on the topology; errors stay in the notification and the log. */
export async function validateLab(node?: ClabLabTreeNode | vscode.Uri): Promise<void> {
  try {
    const target = await labForNode(node);
    if (!target) return;
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Validating ${target.labName}...` },
      () => target.lab.backend.validate(target.lab.target)
    );
    if (result.valid) {
      vscode.window.showInformationMessage(
        `${target.labName} is valid: ${result.nodes} nodes, ${result.links} links.`
      );
      return;
    }
    const error = result.error?.trim() || "containerlab rejected the topology.";
    outputChannel.error(`containerlab validate ${target.labPath}: ${error}`);
    const choice = await vscode.window.showErrorMessage(
      `${target.labName} is not valid: ${error}`,
      "Show Logs"
    );
    if (choice === "Show Logs") outputChannel.show(true);
  } catch (error) {
    vscode.window.showErrorMessage(`Validate failed: ${errorText(error)}`);
  }
}

const GRAPH_LABELS: Record<GraphExportFormat, string> = { mermaid: "Mermaid", dot: "Graphviz" };

async function pickMermaidDirection(): Promise<MermaidDirection | undefined> {
  const picked = await vscode.window.showQuickPick(
    [
      { label: "TD", description: "Top down", direction: "TD" as const },
      { label: "LR", description: "Left to right", direction: "LR" as const },
      { label: "BT", description: "Bottom up", direction: "BT" as const },
      { label: "RL", description: "Right to left", direction: "RL" as const }
    ],
    { title: "Mermaid flowchart direction" }
  );
  return picked?.direction;
}

/** `containerlab graph --mermaid|--dot`, saved next to the topology and opened. */
async function exportGraph(
  node: ClabLabTreeNode | vscode.Uri | undefined,
  format: GraphExportFormat
) {
  try {
    const target = await labForNode(node);
    if (!target) return;
    const direction = format === "mermaid" ? await pickMermaidDirection() : undefined;
    if (format === "mermaid" && !direction) return;
    const response = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Generating the ${GRAPH_LABELS[format]} graph of ${target.labName}...`
      },
      () => target.lab.backend.graphExport(target.lab.target, format, { direction })
    );
    if (response.output) outputChannel.info(response.output);
    const fileUri = vscode.Uri.joinPath(labUri(target.labPath), "..", response.fileName);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(response.content, "utf8"));
    await vscode.commands.executeCommand("vscode.open", fileUri);
  } catch (error) {
    vscode.window.showErrorMessage(`${GRAPH_LABELS[format]} export failed: ${errorText(error)}`);
  }
}

export function graphMermaid(node?: ClabLabTreeNode | vscode.Uri): Promise<void> {
  return exportGraph(node, "mermaid");
}

export function graphDot(node?: ClabLabTreeNode | vscode.Uri): Promise<void> {
  return exportGraph(node, "dot");
}

/** Where a generated topology goes: a file on this machine or in a lab host's workspace. */
function generatedFileUri(connection: LabConnection, fileName: string): vscode.Uri {
  if (connection.kind === "api") return remoteUri(connection, fileName);
  return vscode.Uri.file(path.join(getLocalBackend().options.workspaceRoot, fileName));
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function writeGeneratedTopology(
  backend: LabBackend,
  connection: LabConnection,
  result: ClosGeneratorResult
): Promise<vscode.Uri> {
  const fileUri = generatedFileUri(connection, result.fileName);
  if (await fileExists(fileUri)) {
    throw new Error(`${result.fileName} already exists.`);
  }
  const generated = await backend.generateTopology(result.request);
  if (!generated.topologyYaml) throw new Error("containerlab returned no topology.");
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(generated.topologyYaml, "utf8"));
  return fileUri;
}

async function openGeneratedTopology(
  connection: LabConnection,
  fileUri: vscode.Uri,
  labName: string
) {
  const labPath = labPathOf(fileUri);
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fileUri));
  const fileName = path.posix.basename(fileUri.path);
  const node = onConnection(
    new ClabLabTreeNode(
      labName,
      vscode.TreeItemCollapsibleState.None,
      { absolute: labPath, relative: fileName },
      labName
    ),
    connection.id
  );
  await vscode.commands.executeCommand("containerlab.lab.graph.topoViewer", node);
}

/** The Clos wizard in a panel; the topology is generated on the chosen lab host. */
export async function generateClosTopology(
  context: vscode.ExtensionContext,
  target?: unknown
): Promise<void> {
  let connection: LabConnection | undefined = LOCAL_CONNECTION;
  if (target !== undefined) {
    connection = connectionOf(target);
  } else if (getConnections()?.grouped === true) {
    connection = await pickConnection("Generate a Clos topology on");
  }
  if (!connection) return;
  const selected = connection;
  let backend: LabBackend;
  try {
    backend = backendFor(selected);
  } catch (error) {
    vscode.window.showErrorMessage(errorText(error));
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "clabClosGenerator",
    "Generate Clos Topology",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, "dist"),
        vscode.Uri.joinPath(context.extensionUri, "resources")
      ]
    }
  );
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "resources", "containerlab.svg");
  const initialData: ClosGeneratorInitialData = {
    targetLabel: isThisComputer(selected) ? "this machine" : selected.label
  };
  panel.webview.html = createPanelWebviewHtml(
    CLOS_GENERATOR_PANEL,
    panel.webview,
    context.extensionUri,
    initialData
  );

  panel.webview.onDidReceiveMessage(
    async (message: { command?: string; data?: ClosGeneratorResult }) => {
      if (message.command === "cancel") {
        panel.dispose();
        return;
      }
      if (message.command !== "generate" || !message.data) return;
      try {
        const fileUri = await writeGeneratedTopology(backend, selected, message.data);
        panel.dispose();
        await openGeneratedTopology(selected, fileUri, message.data.request.name);
      } catch (error) {
        void panel.webview.postMessage({ command: "status", busy: false, error: errorText(error) });
      }
    }
  );
}
