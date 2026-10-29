import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

// Drives a Kubernetes cluster with clabernetes as a lab host: deploy a lab on
// it, find the lab and its nodes in the explorer, open a shell, follow the
// logs, save a capture and destroy the lab. Opt-in: set CLAB_E2E_C9S_CONTEXT
// and CLAB_E2E_C9S_KUBECONFIG. The cluster entry names that kubeconfig file, so
// VS Code needs no KUBECONFIG; if it has one, it must be that file, so nothing
// reaches another cluster. CLAB_E2E_CLAB_BINARY names the
// containerlab to run (else PATH). CLAB_E2E_WIRESHARK names a program to run as
// Wireshark: a stand-in that writes its arguments to <program>.args and the stream on its
// stdin to <program>.pcapng, then <program>.done once it exits, lets the test check what
// Wireshark gets.
const kubeContext = process.env.CLAB_E2E_C9S_CONTEXT ?? "";
const kubeconfig = process.env.CLAB_E2E_C9S_KUBECONFIG ?? "";
const labName = `vscode-c9s-${process.pid}`;
const namespace = `c9s-${labName}`;
const SAVE_INSTEAD = "Save .pcapng instead";
const wireshark = process.env.CLAB_E2E_WIRESHARK ?? "";

interface Connection {
  id: string;
  label: string;
  kind: "local" | "api";
  kubeconfig?: string;
}

interface TreeNode {
  name?: string;
  connectionId?: string;
  labPath: { absolute: string };
  containers?: TreeNode[];
  interfaces?: TreeNode[];
}

interface ExtensionApi {
  getConnections(): {
    addClusterConnection(input: { kubeContext: string; kubeconfig?: string }): Promise<Connection>;
    removeConnection(connection: Connection): Promise<void>;
  };
  getRunningLabsProvider(): {
    refresh(): Promise<void>;
    discoverInspectLabs(): Promise<Record<string, TreeNode> | undefined>;
  };
}

function kubectl(args: string[]): string {
  return execFileSync("kubectl", ["--kubeconfig", kubeconfig, "--context", kubeContext, ...args], {
    encoding: "utf8"
  }).trim();
}

function topologyCount(): number {
  const output = kubectl(["get", "topologies.c9s.run", "-A", "-o", "name"]);
  return output.split("\n").filter((line) => line.endsWith(`/${labName}`)).length;
}

async function eventually<T>(
  what: string,
  probe: () => Promise<T | undefined> | T | undefined,
  timeoutMs = 60_000
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Timed out waiting for ${what}${lastError instanceof Error ? `: ${lastError.message}` : ""}`
  );
}

type Window = typeof vscode.window;

/** Replaces window functions for the suite; the originals come back in `restore`. */
class WindowStubs {
  private readonly originals = new Map<keyof Window, unknown>();
  /** What extension terminals (Pseudoterminals) wrote, by terminal name. */
  readonly output = new Map<string, string>();
  readonly errors: string[] = [];

  stub<K extends keyof Window>(name: K, replacement: Window[K]): void {
    if (!this.originals.has(name)) this.originals.set(name, vscode.window[name]);
    (vscode.window as unknown as Record<string, unknown>)[name] = replacement;
  }

  original<K extends keyof Window>(name: K): Window[K] {
    return (this.originals.get(name) ?? vscode.window[name]) as Window[K];
  }

  restore(): void {
    for (const [name, original] of this.originals) {
      (vscode.window as unknown as Record<string, unknown>)[name] = original;
    }
    this.originals.clear();
  }
}

(kubeContext && kubeconfig ? suite : suite.skip)("Containerlab on a Kubernetes cluster (c9s)", function () {
  this.timeout(15 * 60_000);
  const workspace = process.env.VSCODE_CONTAINERLAB_E2E_WORKSPACE ?? "";
  const topologyPath = path.join(workspace, `${labName}.clab.yml`);
  const capturePath = path.join(workspace, `${labName}.pcapng`);
  const stubs = new WindowStubs();
  let api: ExtensionApi;
  let cluster: Connection;

  suiteSetup(async () => {
    assert.ok(
      process.env.KUBECONFIG === undefined || process.env.KUBECONFIG === kubeconfig,
      "VS Code reaches no other cluster through KUBECONFIG"
    );
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
    // Quick picks and dialogs answer as a user would: the cluster, save the
    // capture for 5 seconds into the workspace.
    stubs.stub("showQuickPick", (async (items: unknown, options?: vscode.QuickPickOptions) => {
      const list = (await items) as Array<vscode.QuickPickItem & Record<string, unknown>>;
      const title = options?.title ?? "";
      if (title.startsWith("Deploy ")) {
        return list.find((item) => (item.connection as Connection | undefined)?.id === cluster.id);
      }
      if (options?.placeHolder === "Open the capture in") {
        return list.find((item) => item.delivery === "save");
      }
      if (options?.placeHolder === "Capture for") return list.find((item) => item.label === "5 seconds");
      if (options?.canPickMany === true) return list.filter((item) => item.picked === true);
      throw new Error(`Unexpected quick pick: ${title} ${options?.placeHolder ?? ""}`);
    }) as Window["showQuickPick"]);
    stubs.stub("showSaveDialog", (async () => vscode.Uri.file(capturePath)) as Window["showSaveDialog"]);
    // Without Wireshark on this machine a capture offers to save the file instead.
    stubs.stub("showErrorMessage", (async (message: string, ...items: unknown[]) => {
      stubs.errors.push(message);
      return items.find((item) => item === SAVE_INSTEAD);
    }) as Window["showErrorMessage"]);
    // The cleanup warning is confirmed; other warnings are failures.
    stubs.stub("showWarningMessage", (async (message: string, ...items: unknown[]) => {
      if (message.startsWith("WARNING: Destroy (cleanup)")) return items.find((item) => item === "Yes");
      stubs.errors.push(message);
      return undefined;
    }) as Window["showWarningMessage"]);
    const createTerminal = stubs.original("createTerminal");
    stubs.stub("createTerminal", ((...args: unknown[]) => {
      const options = args[0] as vscode.ExtensionTerminalOptions | undefined;
      if (options && typeof options === "object" && "pty" in options) {
        options.pty.onDidWrite((data) => {
          stubs.output.set(options.name, (stubs.output.get(options.name) ?? "") + data);
        });
      }
      return (createTerminal as (...rest: unknown[]) => vscode.Terminal)(...args);
    }) as Window["createTerminal"]);

    const extension = vscode.extensions.getExtension<ExtensionApi>("srl-labs.vscode-containerlab");
    assert.ok(extension);
    api = await extension.activate();
    // The entry names its kubeconfig file, as "Choose kubeconfig file…" stores it.
    cluster = await api.getConnections().addClusterConnection({ kubeContext, kubeconfig });
    assert.equal(cluster.kubeconfig, kubeconfig);
  });

  suiteTeardown(async () => {
    try {
      if (topologyCount() > 0) {
        await vscode.commands.executeCommand("containerlab.lab.destroy.cleanup", vscode.Uri.file(topologyPath));
      }
    } finally {
      if (process.env.CLAB_E2E_DEBUG === "1") {
        console.log("messages", stubs.errors);
        for (const [name, text] of stubs.output) console.log(`terminal ${name}: ${JSON.stringify(text.slice(-2000))}`);
      }
      stubs.restore();
      await api.getConnections().removeConnection(cluster);
      fs.rmSync(capturePath, { force: true });
    }
  });

  async function runningLab(): Promise<TreeNode | undefined> {
    const running = api.getRunningLabsProvider();
    await running.refresh();
    const labs = Object.values((await running.discoverInspectLabs()) ?? {});
    return labs.find((entry) => entry.name === labName && entry.connectionId === cluster.id);
  }

  async function treeNode(name: string): Promise<TreeNode> {
    return eventually(`${name} in the explorer`, async () =>
      (await runningLab())?.containers?.find((node) => node.name === `${labName}-${name}`)
    );
  }

  test("deploys the lab on the cluster", async () => {
    await vscode.commands.executeCommand("containerlab.lab.deploy", vscode.Uri.file(topologyPath));
    assert.equal(topologyCount(), 1);
    const pods = kubectl(["get", "pods", "-n", namespace, "-o", "name"]);
    assert.equal(pods.split("\n").filter(Boolean).length, 2, pods);
  });

  test("shows the lab, its nodes and their lab links in the explorer", async () => {
    const lab = await eventually("the lab with both nodes running", async () => {
      const found = await runningLab();
      return found?.containers?.length === 2 ? found : undefined;
    });
    // containerlab reports the file the lab was deployed from.
    assert.equal(lab.labPath.absolute, topologyPath);
    assert.deepEqual(lab.containers?.map((node) => node.name).sort(), [`${labName}-n1`, `${labName}-n2`]);
    const iface = await eventually("eth1 of n1", async () =>
      (await treeNode("n1")).interfaces?.find((entry) => entry.name === "eth1")
    );
    assert.ok(iface);
    const names = ((await treeNode("n1")).interfaces ?? []).map((entry) => entry.name ?? "");
    assert.ok(!names.some((name) => name.startsWith("c9s")), names.join(","));
  });

  test("opens a shell on a node", async () => {
    const node = await treeNode("n1");
    await vscode.commands.executeCommand("containerlab.node.attachShell", node);
    const terminal = await eventually("the shell terminal", () =>
      vscode.window.terminals.find((entry) => entry.name.includes(`${labName}-n1`))
    );
    await eventually("the shell prompt", () =>
      // The shell's prompt, followed by its terminal queries.
      /[#$] /.test(stubs.output.get(terminal.name) ?? "") ? true : undefined
    );
    terminal.sendText("echo c9s-shell-ok > /tmp/e2e-proof");
    const proof = await eventually("the command run in the node", () => {
      const pod = kubectl(["get", "pods", "-n", namespace, "-l", "c9s.run/topologyNode=n1", "-o", "name"]);
      const output = kubectl(["exec", "-n", namespace, pod, "-c", podContainer(pod), "--", "cat", "/tmp/e2e-proof"]);
      return output === "c9s-shell-ok" ? output : undefined;
    });
    assert.equal(proof, "c9s-shell-ok");
    terminal.dispose();
  });

  test("follows a node's logs", async () => {
    const node = await treeNode("n2");
    await vscode.commands.executeCommand("containerlab.node.showLogs", node);
    const terminal = await eventually("the logs terminal", () =>
      vscode.window.terminals.find(
        (entry) => entry.name.includes(`${labName}-n2`) && /log/i.test(entry.name)
      )
    );
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const marker = `c9s-log-${Date.now()}`;
    const pod = kubectl(["get", "pods", "-n", namespace, "-l", "c9s.run/topologyNode=n2", "-o", "name"]);
    kubectl(["exec", "-n", namespace, pod, "-c", podContainer(pod), "--", "sh", "-c", `echo ${marker} > /proc/1/fd/1`]);
    await eventually("the new log line in the terminal", () =>
      (stubs.output.get(terminal.name) ?? "").includes(marker) ? true : undefined
    );
    terminal.dispose();
  });

  test("saves a capture of a lab link", async () => {
    const pod = kubectl(["get", "pods", "-n", namespace, "-l", "c9s.run/topologyNode=n1", "-o", "name"]);
    const container = podContainer(pod);
    kubectl(["exec", "-n", namespace, pod, "-c", container, "--", "ip", "addr", "add", "10.99.0.1/24", "dev", "eth1"]);
    const peer = kubectl(["get", "pods", "-n", namespace, "-l", "c9s.run/topologyNode=n2", "-o", "name"]);
    kubectl(["exec", "-n", namespace, peer, "-c", podContainer(peer), "--", "ip", "addr", "add", "10.99.0.2/24", "dev", "eth1"]);
    const ping = execFileSync(
      "sh",
      ["-c", `kubectl --kubeconfig '${kubeconfig}' --context '${kubeContext}' exec -n ${namespace} ${pod} -c ${container} -- ping -c 30 -i 0.3 10.99.0.2 >/dev/null 2>&1 & echo $!`],
      { encoding: "utf8" }
    ).trim();
    try {
      const iface = await eventually("eth1 of n1", async () =>
        (await treeNode("n1")).interfaces?.find((entry) => entry.name === "eth1")
      );
      await vscode.commands.executeCommand("containerlab.interface.capture", iface);
      const size = await eventually(
        "the saved capture",
        () => {
          if (!fs.existsSync(capturePath)) return undefined;
          const bytes = fs.statSync(capturePath).size;
          return bytes > 1000 ? bytes : undefined;
        },
        60_000
      );
      // Wait for the 5 s capture to finish writing, then check the file.
      await new Promise((resolve) => setTimeout(resolve, 7000));
      const data = fs.readFileSync(capturePath);
      assert.equal(data.readUInt32LE(0), 0x0a0d0d0a, "a pcapng section header");
      assert.ok(size > 1000);
      assert.ok(data.includes(Buffer.from("n1:eth1")), "the interface is named <node>:<interface>");
    } finally {
      try {
        process.kill(Number(ping));
      } catch {
        // The ping already finished.
      }
    }
    // Only the missing Wireshark, if this machine has none: the capture was saved instead.
    assert.deepEqual(
      stubs.errors.filter((message) => !message.startsWith("Wireshark was not found")),
      []
    );
  });

  (wireshark ? test : test.skip)("pipes a capture into Wireshark in a terminal", async () => {
    for (const suffix of [".args", ".pcapng", ".done"]) fs.rmSync(`${wireshark}${suffix}`, { force: true });
    const config = vscode.workspace.getConfiguration("containerlab");
    await config.update("capture.wireshark.path", wireshark, vscode.ConfigurationTarget.Global);
    const pod = kubectl(["get", "pods", "-n", namespace, "-l", "c9s.run/topologyNode=n1", "-o", "name"]);
    const ping = execFileSync(
      "sh",
      ["-c", `kubectl --kubeconfig '${kubeconfig}' --context '${kubeContext}' exec -n ${namespace} ${pod} -c ${podContainer(pod)} -- ping -c 40 -i 0.3 10.99.0.2 >/dev/null 2>&1 & echo $!`],
      { encoding: "utf8" }
    ).trim();
    try {
      const iface = await eventually("eth1 of n1", async () =>
        (await treeNode("n1")).interfaces?.find((entry) => entry.name === "eth1")
      );
      await vscode.commands.executeCommand("containerlab.interface.capture", iface);
      const terminal = await eventually("the capture terminal", () =>
        vscode.window.terminals.find((entry) => entry.name === "Capture n1:eth1")
      );
      const args = await eventually("Wireshark to start", () =>
        fs.existsSync(`${wireshark}.args`) ? fs.readFileSync(`${wireshark}.args`, "utf8").trim() : undefined
      );
      assert.equal(args, "-k -i -", "Wireshark starts capturing from its stdin");
      // The stand-in quits after a few seconds, as a user closing Wireshark; the capture ends with it.
      await eventually("Wireshark to quit", () => (fs.existsSync(`${wireshark}.done`) ? true : undefined), 60_000);
      const data = fs.readFileSync(`${wireshark}.pcapng`);
      assert.equal(data.readUInt32LE(0), 0x0a0d0d0a, "a pcapng section header");
      assert.ok(data.includes(Buffer.from("n1:eth1")), "the interface is named <node>:<interface>");
      await eventually("containerlab's capture to end", () => {
        try {
          execFileSync("pgrep", ["-f", `capture --name ${labName}`]);
          return undefined;
        } catch {
          return true;
        }
      });
      terminal.dispose();
    } finally {
      await config.update("capture.wireshark.path", undefined, vscode.ConfigurationTarget.Global);
      try {
        process.kill(Number(ping));
      } catch {
        // The ping already finished.
      }
    }
  });

  test("destroys the lab with its storage", async () => {
    await vscode.commands.executeCommand("containerlab.lab.destroy.cleanup", vscode.Uri.file(topologyPath));
    assert.equal(topologyCount(), 0);
    await eventually("the lab's namespace to go", () =>
      kubectl(["get", "namespaces", "-o", "name"]).split("\n").includes(`namespace/${namespace}`) ? undefined : true
    );
  });
});

/** The device container of a lab pod: the one that is not clabernetes' own. */
function podContainer(pod: string): string {
  const name = pod.replace(/^pod\//, "");
  const names = kubectl(["get", "pod", name, "-n", namespace, "-o", "jsonpath={.spec.containers[*].name}"]);
  const device = names.split(" ").find((entry) => entry.startsWith("node-"));
  if (!device) throw new Error(`No device container in ${pod}: ${names}`);
  return device;
}

