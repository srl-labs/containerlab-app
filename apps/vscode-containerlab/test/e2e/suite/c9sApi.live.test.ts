import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import WebSocket from "ws";

// Captures through a clab-api-server that runs labs on Kubernetes (CLAB_RUNTIME=c9s): a
// packetflix: link from a capture ticket, and Wireshark VNC in a panel. Opt-in: set
// CLAB_E2E_C9S_API_URL, CLAB_E2E_C9S_API_USER and CLAB_E2E_C9S_API_PASSWORD, and
// CLAB_E2E_C9S_API_KUBECONFIG and CLAB_E2E_C9S_API_CONTEXT for a kubectl that may exec into
// the lab's pods (the test pings across the link). The server must run on this machine, so the
// test can check its Wireshark VNC containers.
const apiUrl = process.env.CLAB_E2E_C9S_API_URL ?? "";
const apiUser = process.env.CLAB_E2E_C9S_API_USER ?? "";
const apiPassword = process.env.CLAB_E2E_C9S_API_PASSWORD ?? "";
const kubeconfig = process.env.CLAB_E2E_C9S_API_KUBECONFIG ?? "";
const kubeContext = process.env.CLAB_E2E_C9S_API_CONTEXT ?? "";
const labName = `vscode-api-${process.pid}`;
const namespace = `c9s-${apiUser}-${labName}`;

interface Connection {
  id: string;
  label: string;
  kind: "local" | "api";
}

interface TreeNode {
  name?: string;
  connectionId?: string;
  containers?: TreeNode[];
  interfaces?: TreeNode[];
}

interface ExtensionApi {
  getConnections(): {
    addConnection(label: string, url: string): Promise<Connection>;
    removeConnection(connection: Connection): Promise<void>;
    signIn(connection: Connection, username: string, password: string): Promise<unknown>;
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

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8" }).trim();
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

/** The device container of a lab pod: the one that is not clabernetes' own. */
function podOf(node: string): { pod: string; container: string } {
  const pod = kubectl(["get", "pods", "-n", namespace, "-l", `c9s.run/topologyNode=${node}`, "-o", "name"]);
  const names = kubectl(["get", pod, "-n", namespace, "-o", "jsonpath={.spec.containers[*].name}"]);
  const container = names.split(" ").find((entry) => entry.startsWith("node-"));
  if (!container) throw new Error(`No device container in ${pod}: ${names}`);
  return { pod, container };
}

/**
 * Redeems a Packetflix link the way Wireshark's cshargextcap does: a websocket whose binary
 * messages are the pcapng stream. Reads it for `ms`; the HTTP status when it is refused.
 */
function redeem(link: string, ms: number): Promise<{ status: number; bytes: Buffer }> {
  const url = link.replace(/^packetflix:/, "");
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const socket = new WebSocket(url);
    socket.on("upgrade", () => setTimeout(() => socket.close(1000), ms));
    socket.on("message", (data: Buffer) => chunks.push(Buffer.from(data)));
    socket.on("close", () => resolve({ status: 101, bytes: Buffer.concat(chunks) }));
    socket.on("unexpected-response", (_request, response) => {
      resolve({ status: response.statusCode ?? 0, bytes: Buffer.alloc(0) });
      socket.terminate();
    });
    socket.on("error", () => resolve({ status: 0, bytes: Buffer.concat(chunks) }));
  });
}

function wiresharkTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.label.startsWith("Wireshark ("));
}

(apiUrl && kubeconfig ? suite : suite.skip)("Captures through a c9s clab-api-server", function () {
  this.timeout(15 * 60_000);
  const workspace = process.env.VSCODE_CONTAINERLAB_E2E_WORKSPACE ?? "";
  const linkCapture = path.join(workspace, `${labName}-packetflix.pcapng`);
  const opened: string[] = [];
  const env = vscode.env as unknown as Record<string, unknown>;
  const openExternal = env.openExternal;
  let api: ExtensionApi;
  let connection: Connection;
  let folder: vscode.Uri;
  let topology: vscode.Uri;
  let ping: ReturnType<typeof spawn> | undefined;

  suiteSetup(async () => {
    // packetflix: links go to Wireshark through the OS; here they are kept for the test.
    env.openExternal = async (uri: vscode.Uri) => {
      opened.push(uri.toString(true));
      return true;
    };
    const extension = vscode.extensions.getExtension<ExtensionApi>("srl-labs.vscode-containerlab");
    assert.ok(extension);
    api = await extension.activate();
    connection = await api.getConnections().addConnection("c9s lab host", apiUrl);
    await api.getConnections().signIn(connection, apiUser, apiPassword);
    folder = vscode.Uri.from({ scheme: "clab-api", authority: connection.id, path: `/${labName}` });
    topology = vscode.Uri.joinPath(folder, `${labName}.clab.yml`);
  });

  suiteTeardown(async () => {
    env.openExternal = openExternal;
    ping?.kill();
    for (const tab of wiresharkTabs()) await vscode.window.tabGroups.close(tab);
    const topologies = kubectl(["get", "topologies.c9s.run", "-A", "-o", "name"]).split("\n");
    if (topologies.some((line) => line.endsWith(`/${labName}`))) {
      await vscode.commands.executeCommand("containerlab.lab.destroy", topology);
    }
    await vscode.workspace.fs.delete(folder, { recursive: true }).then(undefined, () => {});
    await api.getConnections().removeConnection(connection);
  });

  async function eth1OfN1(): Promise<TreeNode> {
    const running = api.getRunningLabsProvider();
    return eventually("eth1 of n1 in the explorer", async () => {
      await running.refresh();
      const labs = Object.values((await running.discoverInspectLabs()) ?? {});
      const node = labs
        .find((entry) => entry.name === labName && entry.connectionId === connection.id)
        ?.containers?.find((entry) => entry.name === `${labName}-n1`);
      return node?.interfaces?.find((entry) => entry.name === "eth1");
    });
  }

  test("deploys a two-node lab on the server's cluster", async () => {
    await vscode.workspace.fs.createDirectory(folder);
    await vscode.workspace.fs.writeFile(
      topology,
      new TextEncoder().encode(
        [
          `name: ${labName}`,
          "topology:",
          "  nodes:",
          "    n1: { kind: linux, image: alpine:3 }",
          "    n2: { kind: linux, image: alpine:3 }",
          "  links:",
          '    - endpoints: ["n1:eth1", "n2:eth1"]',
          ""
        ].join("\n")
      )
    );
    await vscode.commands.executeCommand("containerlab.lab.deploy", topology);
    const pods = kubectl(["get", "pods", "-n", namespace, "-o", "name"]);
    assert.equal(pods.split("\n").filter(Boolean).length, 2, pods);
    await eth1OfN1();
    // n1 pings n2 across the link for the captures below.
    const n1 = podOf("n1");
    const n2 = podOf("n2");
    kubectl(["exec", "-n", namespace, n1.pod, "-c", n1.container, "--", "ip", "addr", "add", "10.98.0.1/24", "dev", "eth1"]);
    kubectl(["exec", "-n", namespace, n2.pod, "-c", n2.container, "--", "ip", "addr", "add", "10.98.0.2/24", "dev", "eth1"]);
    ping = spawn(
      "kubectl",
      ["--kubeconfig", kubeconfig, "--context", kubeContext, "exec", "-n", namespace, n1.pod, "-c", n1.container, "--", "ping", "-i", "0.3", "10.98.0.2"],
      { stdio: "ignore" }
    );
  });

  test("opens a capture ticket's packetflix: link, which streams the link once", async () => {
    await vscode.commands.executeCommand("containerlab.interface.capture", await eth1OfN1());
    const link = await eventually("the packetflix: link", () => opened.find((uri) => uri.startsWith("packetflix:")));
    assert.match(link, /^packetflix:ws:\/\/[^/]+\/api\/v1\/capture\/packetflix\/[A-Za-z0-9_-]{43}\?container=/);
    const container = JSON.parse(new URL(link.replace(/^packetflix:/, "")).searchParams.get("container") ?? "{}") as {
      type?: string;
      "network-interfaces"?: string[];
    };
    assert.equal(container.type, "c9s-lab");
    assert.deepEqual(container["network-interfaces"], ["n1:eth1"]);

    const capture = await redeem(link, 5000);
    assert.equal(capture.status, 101);
    fs.writeFileSync(linkCapture, capture.bytes);
    assert.equal(capture.bytes.readUInt32LE(0), 0x0a0d0d0a, "a pcapng section header");
    assert.ok(capture.bytes.includes(Buffer.from("n1:eth1")), "the interface is named <node>:<interface>");
    assert.ok(capture.bytes.length > 1000, `only ${capture.bytes.length} bytes`);
    console.log(`packetflix capture: ${linkCapture} (${capture.bytes.length} bytes)`);

    // A ticket is single use.
    assert.equal((await redeem(link, 0)).status, 404);
  });

  test("opens Wireshark VNC in a panel and ends its session when the panel closes", async () => {
    const before = docker(["ps", "-a", "--filter", "name=clab_ws_vnc_", "--format", "{{.Names}}"]).split("\n");
    await vscode.commands.executeCommand("containerlab.interface.captureWithEdgesharkVNC", await eth1OfN1());
    await eventually("the Wireshark panel", () => wiresharkTabs().at(0));
    const vncContainer = await eventually("the Wireshark VNC container", () =>
      docker(["ps", "--filter", "name=clab_ws_vnc_", "--format", "{{.Names}}"])
        .split("\n")
        .find((name) => name.includes(labName) && !before.includes(name))
    );
    await eventually(
      "noVNC in the Wireshark container",
      () => {
        const status = docker(["exec", vncContainer, "curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "http://127.0.0.1:5800/"]);
        return status === "200" ? status : undefined;
      },
      120_000
    );
    // The session's Packetflix link, which Wireshark in the container uses for its capture.
    const containerEnv = docker(["inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", vncContainer]);
    const link = /PACKETFLIX_LINK=(packetflix:\S+)/.exec(containerEnv)?.[1];
    assert.ok(link, "the container has a Packetflix link");
    const local = link.replace(/^packetflix:ws:\/\/[^/]+/, `packetflix:${apiUrl.replace(/^http/, "ws")}`);
    assert.equal((await redeem(local, 0)).status, 101, "the session's ticket works while the panel is open");

    for (const tab of wiresharkTabs()) await vscode.window.tabGroups.close(tab);
    await eventually("the Wireshark VNC container to go", () =>
      docker(["ps", "-a", "--filter", `name=${vncContainer}`, "--format", "{{.Names}}"]) === "" ? true : undefined
    );
    assert.equal((await redeem(local, 0)).status, 404, "closing the panel revokes the session's ticket");
  });

  test("destroys the lab", async () => {
    ping?.kill();
    await vscode.commands.executeCommand("containerlab.lab.destroy", topology);
    await eventually("the lab's Topology to go", () =>
      kubectl(["get", "topologies.c9s.run", "-A", "-o", "name"]).split("\n").some((line) => line.endsWith(`/${labName}`))
        ? undefined
        : true,
      180_000
    );
  });
});
