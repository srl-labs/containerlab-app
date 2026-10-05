import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

import { openTabs, waitForTab } from "./tabs";

suite("Containerlab settings VS Code smoke", () => {
  test("opens a single settings editor from the registered command", async () => {
    const extension = vscode.extensions.getExtension("srl-labs.vscode-containerlab");
    assert.ok(extension);
    await extension.activate();
    assert.ok(fs.existsSync(path.join(extension.extensionPath, "dist", "settingsWebview.js")));
    await vscode.commands.executeCommand("containerlab.settings.open");
    await vscode.commands.executeCommand("containerlab.settings.open");
    const isSettingsTab = (tab: vscode.Tab) => tab.label === "Containerlab Settings";
    await waitForTab((tab) => isSettingsTab(tab) && tab.isActive, "an active settings tab", 10000);
    assert.equal(openTabs().filter(isSettingsTab).length, 1);
  });
});
