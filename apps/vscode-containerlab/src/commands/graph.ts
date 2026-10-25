import * as fs from "fs";

import * as vscode from "vscode";

import type { ClabLabTreeNode } from "../treeView/common";
import type { ReactTopoViewer } from "../reactTopoViewer";
import { ReactTopoViewerProvider } from "../reactTopoViewer";
import { getSelectedLabNode } from "../utils/utils";
import { MSG_LAB_LIFECYCLE_LOG, MSG_LAB_LIFECYCLE_STATUS } from "@containerlab/clab-ui/session";
import {
  isTopologyFileName,
  isTopologyTemplateFileName,
  topologyFileStem
} from "@containerlab/clab-ui/host";

import {
  getLocalBackend,
  isRemote,
  isUriString,
  labNameForPath,
  labPathOf,
  labUri,
  resolveLab
} from "../backend/labBackends";

import { execCommandInTerminal, runWithProgress } from "./command";
import { showRenderedTopology } from "./renderedTopology";

/**
 * Core routine for generating draw.io graphs.
 */
async function runGraphDrawIO(
  node: ClabLabTreeNode | undefined,
  layout: "horizontal" | "vertical"
) {
  node = await getSelectedLabNode(node);
  if (!node) {
    return;
  }
  if (!node.labPath.absolute) {
    vscode.window.showErrorMessage("No lab path found. Cannot open .drawio file.");
    return;
  }
  const labPath = node.labPath.absolute;
  const labName = node.name ?? labNameForPath(labPath);
  const drawioTheme = vscode.workspace
    .getConfiguration("containerlab")
    .get<string>("drawioDefaultTheme", "nokia_modern");

  let drawioUri = labUri(labPath);
  await runWithProgress(
    async ({ output }) => {
      const lab = await resolveLab(labPath, labName, node.connectionId);
      const result = await lab.backend.graphDrawio(lab.target, { layout, theme: drawioTheme });
      for (const line of (result.output ?? "").split("\n")) output(line, "stdout");
      const topologyUri = labUri(labPath);
      drawioUri = vscode.Uri.joinPath(topologyUri, "..", result.fileName);
      if (topologyUri.scheme !== "file" || !fs.existsSync(drawioUri.fsPath)) {
        // A lab host returns the file instead of writing it next to the topology.
        await vscode.workspace.fs.writeFile(drawioUri, Buffer.from(result.content, "utf8"));
      }
    },
    {
      spinnerMsg: {
        progressMsg: `Generating the draw.io graph of ${labName}...`,
        successMsg: ""
      },
      actionName: "graph",
      onSuccess: async () => {
        await vscode.commands.executeCommand("vscode.open", drawioUri);
      }
    }
  );
}

export async function graphDrawIOHorizontal(node?: ClabLabTreeNode) {
  await runGraphDrawIO(node, "horizontal");
}

export async function graphDrawIOVertical(node?: ClabLabTreeNode) {
  await runGraphDrawIO(node, "vertical");
}

/**
 * Graph Lab (draw.io, Interactive) => always run in Terminal
 */
export async function graphDrawIOInteractive(node?: ClabLabTreeNode) {
  node = await getSelectedLabNode(node);
  if (!node) {
    return;
  }
  if (isRemote(node)) {
    vscode.window.showInformationMessage(
      "The interactive draw.io graph runs on this machine only. Use the horizontal or vertical layout for labs on a lab host."
    );
    return;
  }

  const backend = getLocalBackend();
  execCommandInTerminal(
    backend.commandLine([
      "graph",
      "-r",
      backend.options.runtime,
      "--drawio",
      "--drawio-args",
      "-I",
      "-t",
      node.labPath.absolute
    ]),
    "Containerlab Graph"
  );
}

/**
 * Graph Lab (TopoViewer)
 */

let currentTopoViewer: ReactTopoViewer | undefined;

export type LifecycleCommandType =
  "deploy" | "destroy" | "redeploy" | "apply" | "start" | "stop" | "restart";
type LifecycleCommandStream = "stdout" | "stderr";
type TopoViewerLifecycleHandlers = {
  onSuccess: () => Promise<void>;
  onFailure: (error: unknown) => Promise<void>;
  onOutputLine: (line: string, stream: LifecycleCommandStream) => void;
};

function resolveLabPath(node?: ClabLabTreeNode): string | undefined {
  if (node !== undefined && node.labPath.absolute.length > 0) {
    return node.labPath.absolute;
  }

  const editor = vscode.window.activeTextEditor;
  if (editor && isTopologyFileName(editor.document.uri.path)) {
    return labPathOf(editor.document.uri);
  }

  vscode.window.showErrorMessage("No lab node or topology file selected");
  return undefined;
}

export async function graphTopoviewer(node?: ClabLabTreeNode, context?: vscode.ExtensionContext) {
  // Get node if not provided
  node = await getSelectedLabNode(node);

  const labPath = resolveLabPath(node);
  if (labPath === undefined) {
    return;
  }

  if (!context) {
    vscode.window.showErrorMessage("Extension context not available");
    return;
  }

  // Only containerlab can turn a template into a topology: show its rendered result instead.
  if (isTopologyTemplateFileName(labPath)) {
    await showRenderedTopology(labPath, node?.connectionId);
    return;
  }

  // Derive the lab name
  const labName =
    node?.name ?? (isUriString(labPath) ? labNameForPath(labPath) : topologyFileStem(labPath));

  // Use the provider to create/get the viewer. The viewer is always editable;
  // it attaches runtime data on its own when the lab is deployed.
  const provider = ReactTopoViewerProvider.getInstance(context);
  const viewer = await provider.openViewer(labPath, labName);

  currentTopoViewer = viewer;
  viewer.requestFitViewport();

  // Set context for any UI state
  vscode.commands.executeCommand("setContext", "isTopoviewerActive", true);

  // Handle disposal
  if (viewer.currentPanel) {
    viewer.currentPanel.onDidDispose(() => {
      // Closing another lab's viewer leaves the last opened one current.
      if (currentTopoViewer !== viewer) return;
      currentTopoViewer = undefined;
      vscode.commands.executeCommand("setContext", "isTopoviewerActive", false);
    });
  }
}

export function getCurrentTopoViewer(): ReactTopoViewer | undefined {
  return currentTopoViewer;
}

/**
 * The viewer a lifecycle command reports to: the one of its lab, or the last
 * opened viewer when the lab is unknown. A lab without an open viewer gets none.
 */
function lifecycleViewer(labPath?: string): ReactTopoViewer | undefined {
  if (labPath !== undefined && labPath !== "") return ReactTopoViewerProvider.findViewer(labPath);
  return currentTopoViewer;
}

async function postLifecycleStatus(
  viewer: ReactTopoViewer | undefined,
  commandType: LifecycleCommandType,
  status: "success" | "error",
  errorMessage?: string
): Promise<void> {
  if (!viewer?.currentPanel) {
    return;
  }

  try {
    await viewer.currentPanel.webview.postMessage({
      type: MSG_LAB_LIFECYCLE_STATUS,
      data: { commandType, status, errorMessage }
    });
  } catch (err) {
    console.error(`Failed to publish lifecycle status (${status}) for ${commandType}:`, err);
  }
}

async function postLifecycleLog(
  viewer: ReactTopoViewer | undefined,
  commandType: LifecycleCommandType,
  line: string,
  stream: LifecycleCommandStream
): Promise<void> {
  if (!viewer?.currentPanel || !line) {
    return;
  }

  try {
    await viewer.currentPanel.webview.postMessage({
      type: MSG_LAB_LIFECYCLE_LOG,
      data: { commandType, line, stream }
    });
  } catch (err) {
    console.error(`Failed to publish lifecycle log for ${commandType}:`, err);
  }
}

/**
 * Updates the lab's viewer after a containerlab command completed successfully.
 * This should ONLY be called after a containerlab command has successfully completed
 */
async function notifyTopoViewerOfCommandSuccess(
  commandType: LifecycleCommandType,
  labPath: string | undefined,
  labKeepsRunning = false
) {
  const viewer = lifecycleViewer(labPath);
  if (!viewer?.currentPanel) {
    return;
  }

  // Determine the new state based on the command
  const newDeploymentState =
    commandType === "destroy" && !labKeepsRunning ? "undeployed" : "deployed";

  try {
    if (typeof viewer.refreshAfterExternalCommand === "function") {
      await viewer.refreshAfterExternalCommand(newDeploymentState);
    }
  } catch (error) {
    console.error(`Failed to update TopoViewer after ${commandType}:`, error);
  } finally {
    await postLifecycleStatus(viewer, commandType, "success");
  }
}

/** Tells the lab's viewer, or the last opened one when the lab is unknown, that a command failed. */
export async function notifyCurrentTopoViewerOfCommandFailure(
  commandType: LifecycleCommandType,
  error: unknown,
  labPath?: string
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  await postLifecycleStatus(lifecycleViewer(labPath), commandType, "error", errorMessage);
}

/** Output, status and refresh of a lifecycle command go to the viewer of `labPath`. */
export function createTopoViewerLifecycleHandlers(
  commandType: LifecycleCommandType,
  options: { labKeepsRunning?: boolean; labPath?: string } = {}
): TopoViewerLifecycleHandlers {
  return {
    onSuccess: async () => {
      await notifyTopoViewerOfCommandSuccess(commandType, options.labPath, options.labKeepsRunning);
    },
    onFailure: async (error) => {
      await notifyCurrentTopoViewerOfCommandFailure(commandType, error, options.labPath);
    },
    onOutputLine: (line, stream) => {
      void postLifecycleLog(lifecycleViewer(options.labPath), commandType, line, stream);
    }
  };
}
