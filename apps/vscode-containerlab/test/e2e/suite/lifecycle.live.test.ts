import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

// Deploys a real lab through the extension's commands. Opt-in: it needs
// containerlab and a container runtime, so run with CLAB_E2E_LIVE=1.
const live = process.env.CLAB_E2E_LIVE === "1";
const labName = `vscode-e2e-${process.pid}`;

function labContainers(): string[] {
  const output = execFileSync(
    "docker",
    ["ps", "-a", "--filter", `label=containerlab=${labName}`, "--format", "{{.Names}}"],
    { encoding: "utf8" }
  );
  return output.split("\n").filter(Boolean).sort();
}

(live ? suite : suite.skip)("Containerlab lifecycle against local containerlab", () => {
  const workspace = process.env.VSCODE_CONTAINERLAB_E2E_WORKSPACE ?? "";
  const topologyPath = path.join(workspace, `${labName}.clab.yml`);

  suiteSetup(async () => {
    fs.writeFileSync(
      topologyPath,
      [
        `name: ${labName}`,
        "topology:",
        "  nodes:",
        "    n1: { kind: linux, image: alpine:3 }",
        "    n2: { kind: linux, image: alpine:3 }",
        "  links:",
        '    - endpoints: ["n1:eth1", "n2:eth1"]',
        ""
      ].join("\n"),
      "utf8"
    );
    const extension = vscode.extensions.getExtension("srl-labs.vscode-containerlab");
    assert.ok(extension);
    await extension.activate();
  });

  suiteTeardown(async () => {
    if (labContainers().length > 0) {
      await vscode.commands.executeCommand(
        "containerlab.lab.destroy",
        vscode.Uri.file(topologyPath)
      );
    }
  });

  test("deploys, stops, starts and destroys a lab through the lab backend", async () => {
    const topology = vscode.Uri.file(topologyPath);

    await vscode.commands.executeCommand("containerlab.lab.deploy", topology);
    assert.deepEqual(labContainers(), [`clab-${labName}-n1`, `clab-${labName}-n2`]);

    await vscode.commands.executeCommand("containerlab.lab.stop", topology);
    const stopped = execFileSync(
      "docker",
      ["ps", "--filter", `label=containerlab=${labName}`, "--format", "{{.Names}}"],
      { encoding: "utf8" }
    );
    assert.equal(stopped.trim(), "", "stop leaves no node running");

    await vscode.commands.executeCommand("containerlab.lab.start", topology);
    const running = execFileSync(
      "docker",
      ["ps", "--filter", `label=containerlab=${labName}`, "--format", "{{.Names}}"],
      { encoding: "utf8" }
    );
    assert.equal(running.trim().split("\n").length, 2, "start brings both nodes back");

    await vscode.commands.executeCommand("containerlab.lab.destroy", topology);
    assert.deepEqual(labContainers(), []);
  });
});
