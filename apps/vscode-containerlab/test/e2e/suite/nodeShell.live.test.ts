import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

// Attach Shell on a node of a real local lab. The terminal it opens is the
// node's shell and nothing else: it ends with the shell, so what is sent to
// the node afterwards, such as a lab guide's terminal block, never reaches a
// shell of this machine. Opt-in: it needs containerlab and a container
// runtime, so run with CLAB_E2E_LIVE=1.
const live = process.env.CLAB_E2E_LIVE === "1";
const labName = `vscode-shell-${process.pid}`;
const containerName = `clab-${labName}-n1`;
const terminalName = `Shell - ${containerName}`;

interface TreeNode {
  name?: string;
  containers?: TreeNode[];
}

interface ExtensionApi {
  getRunningLabsProvider(): {
    refresh(): Promise<void>;
    discoverInspectLabs(): Promise<Record<string, TreeNode> | undefined>;
  };
}

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
}

function labContainers(): string[] {
  return docker(["ps", "-a", "--filter", `label=containerlab=${labName}`, "--format", "{{.Names}}"])
    .split("\n")
    .filter(Boolean);
}

/** What the node's shell wrote to its proof file, one entry per line. */
function proofInNode(): string[] {
  return docker(["exec", containerName, "sh", "-c", "cat /e2e-proof 2>/dev/null || true"])
    .split("\n")
    .filter(Boolean);
}

async function eventually<T>(
  what: string,
  probe: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 30_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${what}`, { cause: lastError });
}

function openShell(): vscode.Terminal | undefined {
  return vscode.window.terminals.find(
    (terminal) => terminal.name === terminalName && terminal.exitStatus === undefined
  );
}

(live ? suite : suite.skip)("Attach Shell on a node of a local lab", () => {
  const workspace = process.env.VSCODE_CONTAINERLAB_E2E_WORKSPACE ?? "";
  const topologyPath = path.join(workspace, `${labName}.clab.yml`);
  // Written by the shell that takes the text: a shell of this machine stands in the workspace.
  const proofOnHost = path.join(workspace, "e2e-proof");
  let api: ExtensionApi;
  let node: TreeNode;

  suiteSetup(async function () {
    this.timeout(180_000);
    fs.writeFileSync(
      topologyPath,
      [
        `name: ${labName}`,
        "topology:",
        "  nodes:",
        "    n1: { kind: linux, image: alpine:3 }",
        ""
      ].join("\n"),
      "utf8"
    );
    const extension = vscode.extensions.getExtension<ExtensionApi>("srl-labs.vscode-containerlab");
    assert.ok(extension);
    api = await extension.activate();
    await vscode.commands.executeCommand("containerlab.lab.deploy", vscode.Uri.file(topologyPath));
    const running = api.getRunningLabsProvider();
    node = await eventually("the node in the running labs", async () => {
      await running.refresh();
      const labs = Object.values((await running.discoverInspectLabs()) ?? {});
      return labs
        .find((lab) => lab.name === labName)
        ?.containers?.find((container) => container.name === containerName);
    });
  });

  suiteTeardown(async function () {
    this.timeout(120_000);
    for (const terminal of vscode.window.terminals) {
      if (terminal.name === terminalName) terminal.dispose();
    }
    if (labContainers().length > 0) {
      await vscode.commands.executeCommand(
        "containerlab.lab.destroy",
        vscode.Uri.file(topologyPath)
      );
    }
  });

  test("types into the node's shell", async () => {
    await vscode.commands.executeCommand("containerlab.node.attachShell", node);
    const terminal = await eventually("the node's terminal", openShell);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    terminal.sendText("echo first >> e2e-proof");
    await eventually("the line run in the node", () =>
      proofInNode().join() === "first" ? true : undefined
    );
    assert.equal(fs.existsSync(proofOnHost), false);

    // Attach Shell on an open shell brings it forward instead of opening another.
    await vscode.commands.executeCommand("containerlab.node.attachShell", node);
    assert.equal(
      vscode.window.terminals.filter((entry) => entry.name === terminalName).length,
      1
    );
  });

  test("closes the terminal when the node's shell ends, and opens a new one for the next text", async () => {
    const terminal = await eventually("the node's terminal", openShell);
    const closed = new Promise<void>((resolve) => {
      const subscription = vscode.window.onDidCloseTerminal((entry) => {
        if (entry !== terminal) return;
        subscription.dispose();
        resolve();
      });
    });
    terminal.sendText("exit");
    await eventually("the terminal to close with the shell", async () => {
      await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 400))]);
      return vscode.window.terminals.includes(terminal) ? undefined : true;
    });
    assert.equal(openShell(), undefined, "no terminal is left under the node's name");

    // What comes next for the node gets a shell of the node again.
    await vscode.commands.executeCommand("containerlab.node.attachShell", node);
    const next = await eventually("a new terminal for the node", openShell);
    assert.notEqual(next, terminal);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    next.sendText("echo second >> e2e-proof");
    await eventually("the line run in the node", () =>
      proofInNode().join() === "first,second" ? true : undefined
    );
    assert.equal(fs.existsSync(proofOnHost), false, "nothing ran in a shell of this machine");
  });
});
