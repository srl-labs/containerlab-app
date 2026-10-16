import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as vscode from "vscode";

// Drives a clab-api-server through the extension: add the server, browse and
// edit its workspace, deploy, open a node shell and capture a link. Opt-in:
// set CLAB_E2E_API_URL, CLAB_E2E_API_USER and CLAB_E2E_API_PASSWORD. The
// server must run on this machine, so the test can check the containers.
const apiUrl = process.env.CLAB_E2E_API_URL ?? "";
const apiUser = process.env.CLAB_E2E_API_USER ?? "";
const apiPassword = process.env.CLAB_E2E_API_PASSWORD ?? "";
const labName = `vscode-remote-${process.pid}`;

interface Connection {
  id: string;
  label: string;
  kind: "local" | "api";
}

interface Connections {
  addConnection(label: string, url: string): Promise<Connection>;
  removeConnection(connection: Connection): Promise<void>;
  signIn(connection: Connection, username: string, password: string): Promise<unknown>;
  setActive(id: string): Promise<void>;
  activeBackend(): { inspectLab(labName: string): Promise<unknown[]> } | undefined;
}

interface TreeNode {
  name?: string;
  labPath: { absolute: string };
  containers?: TreeNode[];
  interfaces?: TreeNode[];
}

interface ExtensionApi {
  getConnections(): Connections;
  getLocalLabsProvider(): { getChildren(element?: unknown): Promise<TreeNode[] | undefined> };
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
    .filter(Boolean)
    .sort();
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
  throw new Error(
    `Timed out waiting for ${what}${lastError instanceof Error ? `: ${lastError.message}` : ""}`
  );
}

function wiresharkTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.label.startsWith("Wireshark ("));
}

(apiUrl ? suite : suite.skip)("Containerlab through a clab-api-server", function () {
  this.timeout(10 * 60_000);
  let api: ExtensionApi;
  let connection: Connection;
  let folder: vscode.Uri;
  let topology: vscode.Uri;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<ExtensionApi>("srl-labs.vscode-containerlab");
    assert.ok(extension);
    api = await extension.activate();
    const connections = api.getConnections();
    connection = await connections.addConnection("E2E lab server", apiUrl);
    await connections.signIn(connection, apiUser, apiPassword);
    await connections.setActive(connection.id);
    folder = vscode.Uri.from({ scheme: "clab-api", authority: connection.id, path: `/${labName}` });
    topology = vscode.Uri.joinPath(folder, `${labName}.clab.yml`);
  });

  suiteTeardown(async () => {
    for (const tab of wiresharkTabs()) await vscode.window.tabGroups.close(tab);
    if (labContainers().length > 0) {
      await vscode.commands.executeCommand("containerlab.lab.destroy", topology);
    }
    await vscode.workspace.fs.delete(folder, { recursive: true }).then(undefined, () => {});
    await api.getConnections().removeConnection(connection);
  });

  test("browses and edits the server workspace", async () => {
    await vscode.workspace.fs.createDirectory(folder);
    await vscode.workspace.fs.writeFile(
      topology,
      new TextEncoder().encode(
        [
          `name: ${labName}`,
          "topology:",
          "  nodes:",
          "    n1: { kind: linux, image: alpine:3 }",
          ""
        ].join("\n")
      )
    );
    const root = await vscode.workspace.fs.readDirectory(folder.with({ path: "/" }));
    assert.ok(root.some(([name, type]) => name === labName && type === vscode.FileType.Directory));

    // Edit the topology in a text editor and save it to the server.
    const document = await vscode.workspace.openTextDocument(topology);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(
      topology,
      document.positionAt(document.getText().length),
      [
        "    n2: { kind: linux, image: alpine:3 }",
        "  links:",
        '    - endpoints: ["n1:eth1", "n2:eth1"]',
        ""
      ].join("\n")
    );
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(await document.save());
    const saved = new TextDecoder().decode(await vscode.workspace.fs.readFile(topology));
    assert.match(saved, /n2: \{ kind: linux/);

    // The explorer lists it with the server's undeployed labs.
    const listed = await eventually("the topology in the labs list", async () => {
      const labs = (await api.getLocalLabsProvider().getChildren()) ?? [];
      return labs.find((lab) => lab.labPath.absolute === topology.toString());
    });
    assert.equal(listed.name, labName);
  });

  test("opens the topology in the TopoViewer", async () => {
    await vscode.commands.executeCommand("containerlab.lab.graph.topoViewer", topology);
    await eventually("the TopoViewer tab", () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find((tab) => tab.label === labName)
    );
  });

  test("deploys the lab on the server", async () => {
    await vscode.commands.executeCommand("containerlab.lab.deploy", topology);
    assert.deepEqual(labContainers(), [`clab-${labName}-n1`, `clab-${labName}-n2`]);
    const nodes = await api.getConnections().activeBackend()?.inspectLab(labName);
    assert.equal(nodes?.length, 2);
  });

  test("opens a shell on a node through the server", async () => {
    const running = api.getRunningLabsProvider();
    const container = await eventually("the running lab in the tree", async () => {
      await running.refresh();
      const labs = Object.values((await running.discoverInspectLabs()) ?? {});
      const lab = labs.find((entry) => entry.name === labName);
      return lab?.containers?.find((node) => node.name === `clab-${labName}-n1`);
    });
    await vscode.commands.executeCommand("containerlab.node.attachShell", container);
    const terminal = await eventually("the node terminal", () =>
      vscode.window.terminals.find((entry) => entry.name === `Shell - clab-${labName}-n1`)
    );
    await new Promise((resolve) => setTimeout(resolve, 1500));
    terminal.sendText("echo remote-shell-ok > /tmp/e2e-proof");
    const proof = await eventually("the command run in the node", () => {
      const output = docker(["exec", `clab-${labName}-n1`, "cat", "/tmp/e2e-proof"]);
      return output === "remote-shell-ok" ? output : undefined;
    });
    assert.equal(proof, "remote-shell-ok");
    terminal.dispose();
  });

  test("captures a link in Wireshark through the server", async () => {
    const running = api.getRunningLabsProvider();
    const iface = await eventually("eth1 of n1 in the tree", async () => {
      await running.refresh();
      const labs = Object.values((await running.discoverInspectLabs()) ?? {});
      const node = labs
        .find((entry) => entry.name === labName)
        ?.containers?.find((entry) => entry.name === `clab-${labName}-n1`);
      return node?.interfaces?.find((entry) => entry.name === "eth1");
    });
    await vscode.commands.executeCommand("containerlab.interface.captureWithEdgesharkVNC", iface);
    await eventually("the Wireshark panel", () => wiresharkTabs().at(0));
    const vncContainer = await eventually("the Wireshark VNC container", () => {
      const names = docker(["ps", "--filter", "name=clab_ws_vnc_", "--format", "{{.Names}}"]);
      return names.split("\n").find((name) => name.includes(`clab-${labName}-n1`));
    });
    assert.ok(vncContainer);
    // The panel polls the page through the local proxy; give it a moment once noVNC answers.
    await eventually(
      "noVNC in the Wireshark container",
      () => {
        const status = docker([
          "exec",
          vncContainer,
          "curl",
          "-s",
          "-o",
          "/dev/null",
          "-w",
          "%{http_code}",
          "http://127.0.0.1:5800/"
        ]);
        return status === "200" ? status : undefined;
      },
      120_000
    );
    await new Promise((resolve) => setTimeout(resolve, 3000));

    for (const tab of wiresharkTabs()) await vscode.window.tabGroups.close(tab);
    await eventually("the Wireshark VNC container to stop", () => {
      const names = docker(["ps", "--filter", `name=${vncContainer}`, "--format", "{{.Names}}"]);
      return names === "" ? true : undefined;
    });
  });

  test("destroys the lab on the server", async () => {
    await vscode.commands.executeCommand("containerlab.lab.destroy", topology);
    assert.deepEqual(labContainers(), []);
  });
});
