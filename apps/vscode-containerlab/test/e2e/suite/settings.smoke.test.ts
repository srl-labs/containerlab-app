import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

suite("Containerlab settings VS Code smoke", () => {
  test("opens a single settings editor from the registered command", async () => {
    const extension = vscode.extensions.getExtension("srl-labs.vscode-containerlab");
    assert.ok(extension);
    await extension.activate();
    assert.ok(fs.existsSync(path.join(extension.extensionPath, "dist", "settingsWebview.js")));
    await vscode.commands.executeCommand("containerlab.settings.open");
    await vscode.commands.executeCommand("containerlab.settings.open");
    const deadline = Date.now() + 10000;
    while (
      !vscode.window.tabGroups.all.some((group) =>
        group.tabs.some((tab) => tab.label === "Containerlab Settings")
      ) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const tabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.label === "Containerlab Settings");
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].isActive, true);
    const config = vscode.workspace.getConfiguration("containerlab");
    assert.equal(config.get("appearance.colorScheme"), "vscode");
    assert.equal(config.get("capture.wireshark.stayOpenInBackground"), true);
  });
});
