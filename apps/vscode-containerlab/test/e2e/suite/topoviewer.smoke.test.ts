import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import * as vscode from "vscode";

import { waitForTab } from "./tabs";

const EXTENSION_ID = "srl-labs.vscode-containerlab";
const WEBVIEW_VIEW_TYPE = "reactTopoViewer";
// run.ts names the lab differently from its file. The panel opens with the file-derived title and
// only takes the YAML lab name once the webview's initial snapshot request reached the topology host.
const SNAPSHOT_LAB_NAME = "smoke-lab";

function assertEnvPath(name: string): string {
  const value = process.env[name];
  assert.ok(value, `${name} must be set`);
  return value;
}

function assertBuiltWebviewAssets(extensionPath: string): void {
  const requiredAssets = [
    "reactTopoViewerWebview.js",
    "reactTopoViewerStyles.css",
    "maplibre-gl-csp-worker.js",
    "monaco-editor-worker.js",
    "monaco-json-worker.js",
    "monaco-yaml-worker.js"
  ];

  for (const asset of requiredAssets) {
    const assetPath = path.join(extensionPath, "dist", asset);
    assert.ok(fs.existsSync(assetPath), `Expected built webview asset: ${assetPath}`);
  }
}

suite("TopoViewer VS Code smoke", () => {
  test("loads the topology webview and completes the snapshot handshake", async () => {
    const topologyPath = assertEnvPath("VSCODE_CONTAINERLAB_E2E_TOPOLOGY");
    assert.ok(fs.existsSync(topologyPath), `Expected topology fixture: ${topologyPath}`);

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `Expected extension ${EXTENSION_ID} to be installed in test host`);

    await extension.activate();
    assertBuiltWebviewAssets(extension.extensionPath);

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(topologyPath));
    await vscode.window.showTextDocument(document);

    await vscode.commands.executeCommand("containerlab.lab.graph.topoViewer");
    await waitForTab(
      (tab) =>
        tab.isActive &&
        tab.label === SNAPSHOT_LAB_NAME &&
        tab.input instanceof vscode.TabInputWebview &&
        tab.input.viewType.includes(WEBVIEW_VIEW_TYPE),
      `an active ${WEBVIEW_VIEW_TYPE} tab titled "${SNAPSHOT_LAB_NAME}"`
    );
  });
});
