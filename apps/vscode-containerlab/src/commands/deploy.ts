import * as vscode from "vscode";

import { ClabLabTreeNode, onConnection } from "../treeView/common";
import { connectionOf, labPathOf, pickConnection, remoteUri } from "../backend/labBackends";

import { runClabAction } from "./runClabAction";

export async function deploy(node?: ClabLabTreeNode) {
  await runClabAction("deploy", node);
}

export async function deployCleanup(node?: ClabLabTreeNode) {
  await runClabAction("deploy", node, true);
}

/** Deploys a topology file or URL; from a lab host's node in the explorer, on that host. */
export async function deploySpecificFile(target?: unknown) {
  const connection =
    target !== undefined ? connectionOf(target) : await pickConnection("Deploy a lab on");
  if (!connection) {
    return;
  }
  const remote = connection.kind === "api";
  const mode = await vscode.window.showQuickPick(
    [
      remote ? `Select a file on ${connection.label}` : "Select local file",
      "Enter Git/HTTP URL",
      "Choose from popular labs"
    ],
    { title: remote ? `Deploy on ${connection.label} from` : "Deploy from" }
  );

  if (mode === undefined) {
    return;
  }

  let labRef: string | undefined;

  if (mode.startsWith("Select")) {
    const opts: vscode.OpenDialogOptions = {
      title: "Select containerlab topology file",
      filters: {
        yaml: ["yaml", "yml"]
      },
      // A lab host deploys topologies from its own workspace.
      ...(remote ? { defaultUri: remoteUri(connection, "") } : {})
    };

    const uri = await vscode.window.showOpenDialog(opts);
    if (uri === undefined || uri.length === 0) {
      return;
    }
    labRef = labPathOf(uri[0]);
  } else if (mode === "Enter Git/HTTP URL") {
    const input = await vscode.window.showInputBox({
      title: "Git/HTTP URL",
      placeHolder: "https://github.com/user/repo or https://example.com/lab.yml",
      prompt: "Provide a repository or file URL"
    });
    if (input === undefined || input.length === 0) {
      return;
    }
    labRef = input;
  } else {
    // Dynamic import to avoid circular dependency
    const { deployPopularLab } = await import("./deployPopular");
    await deployPopularLab({ connectionId: connection.id });
    return;
  }

  const tempNode = onConnection(
    new ClabLabTreeNode("", vscode.TreeItemCollapsibleState.None, {
      absolute: labRef,
      relative: ""
    }),
    connection.id
  );
  void deploy(tempNode);
}
