import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Writable } from "node:stream";
import test, { type TestContext } from "node:test";

import type { LabEvent } from "../contract/backend.ts";
import type { KubeClient } from "./kube/kubeClient.ts";
import { LocalLabBackend } from "./localLabBackend.ts";

/** A node as `containerlab inspect -r c9s -f json` reports it, with the file the lab was deployed from. */
function inspectNode(absLabPath: string, namespace = "team-a") {
  return {
    name: "demo-n1",
    container_id: "team-a/demo/n1",
    kind: "linux",
    state: "running",
    status: "healthy",
    lab_name: "demo",
    labPath: absLabPath.startsWith("k8s://") ? absLabPath : path.basename(absLabPath),
    absLabPath,
    namespace,
    pod: "demo-n1-pod",
    container: "node-n1-abc",
    exposed_ports: []
  };
}

const PLAN = {
  "lab-name": "demo",
  namespace: "c9s-demo",
  changes: [
    { action: "create", kind: "Node", namespace: "c9s-demo", name: "n3" },
    { action: "recreate", kind: "Node", namespace: "c9s-demo", name: "n1" },
    { action: "update", kind: "Topology", namespace: "c9s-demo", name: "demo" },
    { action: "explode", kind: "Node", name: "bad" }
  ]
};

/** containerlab's c9s events: Docker's actions and attributes, plus `namespace`, `lab`, `node` and `pod`. */
function c9sEvents(topoFile: string): LabEvent[] {
  const node = {
    "clab-node-kind": "linux",
    "clab-node-longname": "demo-n1",
    "clab-node-name": "n1",
    "clab-owner": "clab",
    "clab-topo-file": topoFile,
    containerlab: "demo",
    id: "team-a/demo/n1",
    image: "alpine:3",
    lab: "demo",
    mgmt_ipv4: "172.20.20.73/24",
    name: "demo-n1",
    namespace: "team-a",
    node: "n1",
    pod: "demo-n1-pod"
  };
  const actor = { actor_id: "team-a/demo/n1", actor_name: "demo-n1", actor_full_id: "team-a/demo/n1" };
  const eth1 = {
    id: "team-a/demo/n1",
    ifname: "eth1",
    index: "7",
    lab: "demo",
    mac: "d2:8d:13:51:4a:ed",
    mtu: "9500",
    name: "demo-n1",
    namespace: "team-a",
    node: "n1",
    origin: "clabernetes",
    pod: "demo-n1-pod",
    type: "veth"
  };
  return [
    { timestamp: "2026-10-27T15:43:38Z", type: "container", action: "start", ...actor, attributes: { ...node, state: "running" } },
    { timestamp: "2026-10-27T15:43:39Z", type: "interface", action: "create", ...actor, attributes: { ...eth1, state: "up" } },
    { timestamp: "2026-10-27T15:43:53Z", type: "container", action: "health_status: healthy", ...actor, attributes: { ...node, state: "running" } },
    { timestamp: "2026-10-27T15:44:41Z", type: "interface", action: "update", ...actor, attributes: { ...eth1, state: "lower-layer-down" } },
    { timestamp: "2026-10-27T15:45:06Z", type: "container", action: "die", ...actor, attributes: { ...node, state: "exited" } }
  ];
}

/** An SHB and nothing else: the smallest pcapng file. */
const CAPTURE = (() => {
  const block = Buffer.alloc(28);
  block.writeUInt32LE(0x0a0d0d0a, 0);
  block.writeUInt32LE(28, 4);
  block.writeUInt32LE(0x1a2b3c4d, 8);
  block.writeUInt16LE(1, 12);
  block.writeBigInt64LE(-1n, 16);
  block.writeUInt32LE(28, 24);
  return block;
})();

/**
 * A containerlab for a c9s host: inspect lists one lab, deploy --dry-run
 * plans, --emit-crs prints manifests, events prints c9s events. Every call's
 * arguments and CLAB_KUBE_* variables are logged. The lab reports
 * `deployedFrom` as its file: by default the workspace's demo topology.
 */
async function fakeC9sHost(t: TestContext, deployedFrom?: string, namespace?: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "c9s-backend-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, "workspace");
  const topology = path.join(workspace, "demo", "demo.clab.yml");
  const labFile = deployedFrom ?? topology;
  await fs.writeFile(path.join(directory, "inspect.json"), JSON.stringify({ demo: [inspectNode(labFile, namespace)] }));
  await fs.writeFile(
    path.join(directory, "events.json"),
    c9sEvents(labFile).map((event) => JSON.stringify(event)).join("\n")
  );
  await fs.writeFile(path.join(directory, "plan.json"), JSON.stringify(PLAN));
  await fs.writeFile(path.join(directory, "capture.pcapng"), CAPTURE);
  const binary = path.join(directory, "containerlab");
  await fs.writeFile(
    binary,
    `#!/bin/sh
echo "$* | ns=$CLAB_KUBE_NAMESPACE ctx=$CLAB_KUBE_CONTEXT" >> "${directory}/calls"
case "$*" in
  *"inspect interfaces"*) echo '[{"name":"demo-n1","interfaces":[{"name":"eth1","alias":"","state":"up","type":"veth"}]}]' ;;
  *inspect*) cat "${directory}/inspect.json" ;;
  *"capture"*"--list"*) echo '[{"node":"n1","interface":"eth1","alias":"","peer_node":"n2","peer_interface":"eth1"}]' ;;
  *capture*) cat "${directory}/capture.pcapng" ;;
  *--dry-run*) cat "${directory}/plan.json" ;;
  *--emit-crs*) printf 'apiVersion: c9s.run/v1alpha1\\nkind: Topology\\n' ;;
  events*) cat "${directory}/events.json" ;;
  *) echo "12:00:00 INFO done" >&2 ;;
esac
`,
    { mode: 0o755 }
  );
  await fs.mkdir(path.join(workspace, "demo"), { recursive: true });
  await fs.writeFile(topology, "name: demo\ntopology:\n  nodes: {}\n");
  return {
    workspace,
    topology,
    binary,
    calls: async () => (await fs.readFile(path.join(directory, "calls"), "utf8")).trim().split("\n")
  };
}

function backend(host: { workspace: string; binary: string }, c9s = {}, kubeClient?: KubeClient) {
  return new LocalLabBackend(
    {
      runtime: "c9s",
      binaryPath: host.binary,
      workspaceRoot: host.workspace,
      env: { PATH: "/usr/bin:/bin" },
      c9s: { kubeContext: "kind-c9s-app", ...c9s }
    },
    kubeClient ? { kubeClient } : {}
  );
}

test("c9s labs are inspected with containerlab, not Docker", async (t) => {
  const host = await fakeC9sHost(t);
  const lab = backend(host);
  const nodes = await lab.inspectLab("demo");
  assert.equal(nodes.length, 1);
  assert.equal((nodes[0] as unknown as { pod: string }).pod, "demo-n1-pod");
  assert.equal(await lab.isLabRunning("other"), false);
  assert.deepEqual(await host.calls(), [
    "inspect -r c9s --all --format json | ns= ctx=kind-c9s-app",
    "inspect -r c9s --all --format json | ns= ctx=kind-c9s-app"
  ]);
});

test("deploy passes the host's exposure, persistence and pull secret unless the options set them", async (t) => {
  const host = await fakeC9sHost(t);
  const lab = backend(host, { exposeType: "LoadBalancer", persistence: false, imagePullSecret: "regcred" });
  await lab.runLifecycle("deploy", { labName: "demo", path: "demo/demo.clab.yml" });
  await lab.runLifecycle(
    "deploy",
    { labName: "demo", path: "demo/demo.clab.yml" },
    { lifecycleOptions: { exposeType: "ClusterIP", namespace: "team-b", noPersistence: false, imagePullSecret: "other" } }
  );
  const deploys = (await host.calls()).filter((call) => call.startsWith("deploy"));
  const topology = path.join(host.workspace, "demo", "demo.clab.yml");
  assert.deepEqual(deploys, [
    // The running lab's namespace comes along; a namespace option wins over it.
    `deploy -r c9s --name demo --expose-type LoadBalancer --no-persistence --image-pull-secret regcred -t ${topology} | ns=team-a ctx=kind-c9s-app`,
    `deploy -r c9s --name demo --namespace team-b --expose-type ClusterIP --image-pull-secret other -t ${topology} | ns=team-a ctx=kind-c9s-app`
  ]);
});

test("commands on a running lab take the file it was deployed from, and its namespace from inspect", async (t) => {
  const host = await fakeC9sHost(t);
  const lab = backend(host);
  await lab.runLifecycle("destroy", { labName: "demo" }, { cleanup: true });
  const destroy = (await host.calls()).find((call) => call.startsWith("destroy"));
  assert.equal(destroy, `destroy -r c9s --cleanup -t ${host.topology} | ns=team-a ctx=kind-c9s-app`);
});

test("a lab in its own namespace goes without one, so destroy --cleanup deletes that namespace", async (t) => {
  const host = await fakeC9sHost(t, undefined, "c9s-demo");
  const lab = backend(host);
  await lab.runLifecycle("destroy", { labName: "demo" }, { cleanup: true });
  const destroy = (await host.calls()).find((call) => call.startsWith("destroy"));
  assert.equal(destroy, `destroy -r c9s --cleanup -t ${host.topology} | ns= ctx=kind-c9s-app`);
});

test("a lab deployed from another machine's file, or not by containerlab, goes by its name", async (t) => {
  for (const deployedFrom of ["/home/someone-else/labs/demo.clab.yml", "k8s://team-a/topologies/demo"]) {
    const host = await fakeC9sHost(t, deployedFrom);
    const lab = backend(host);
    await lab.runLifecycle("destroy", { labName: "demo" }, { cleanup: true });
    // A host that sends the running lab's path, as VS Code's explorer does.
    await lab.runLifecycle("stop", { labName: "demo", path: deployedFrom });
    await lab.nodeAction("demo", "demo-n1", "restart");
    await lab.save({ labName: "demo" });
    const calls = (await host.calls()).filter((call) => !call.startsWith("inspect"));
    assert.deepEqual(calls, [
      "destroy -r c9s --cleanup --name demo | ns=team-a ctx=kind-c9s-app",
      "stop -r c9s --name demo | ns=team-a ctx=kind-c9s-app",
      "restart -r c9s --name demo -n n1 | ns=team-a ctx=kind-c9s-app",
      "save -r c9s --name demo | ns=team-a ctx=kind-c9s-app"
    ], deployedFrom);
    await assert.rejects(
      lab.exportManifests({ labName: "demo" }),
      (error: Error & { status?: number }) => error.status === 404
    );
  }
});

test("a fixed namespace goes to every command", async (t) => {
  const host = await fakeC9sHost(t);
  const lab = backend(host, { namespace: "labs" });
  await lab.runLifecycle("stop", { labName: "demo" });
  const stop = (await host.calls()).find((call) => call.startsWith("stop"));
  assert.equal(stop, `stop -r c9s -t ${host.topology} | ns=labs ctx=kind-c9s-app`);
});

test("the apply plan is deploy's dry run, with recreated nodes", async (t) => {
  const host = await fakeC9sHost(t);
  const lab = backend(host);
  const plan = await lab.runLifecycle("apply", { labName: "demo", path: "demo/demo.clab.yml" }, { dryRun: true });
  const result = plan.result as Record<string, unknown>;
  assert.equal(result.dryRun, true);
  assert.equal(result.deployedLab, false, "the Topology exists, so the lab runs");
  assert.deepEqual(result.addedNodes, ["n3"]);
  assert.deepEqual(result.recreatedNodes, ["n1"]);
  assert.equal(result.namespace, "c9s-demo");
  assert.deepEqual(result.changes, PLAN.changes.slice(0, 3));
  const call = (await host.calls()).find((entry) => entry.includes("--dry-run"));
  assert.match(call ?? "", /^deploy -r c9s --dry-run --format json -t /);
});

test("Kubernetes manifests come from deploy --emit-crs", async (t) => {
  const host = await fakeC9sHost(t);
  const lab = backend(host, { exposeType: "None" });
  const { yaml } = await lab.exportManifests({ labName: "demo", path: "demo/demo.clab.yml" });
  assert.match(yaml, /kind: Topology/);
  const call = (await host.calls()).find((entry) => entry.includes("--emit-crs"));
  assert.match(call ?? "", /^deploy -r c9s --emit-crs -t \S+demo\.clab\.yml --name demo --expose-type None \|/);

  const docker = new LocalLabBackend({ binaryPath: host.binary, workspaceRoot: host.workspace });
  await assert.rejects(docker.exportManifests({ labName: "demo" }), (error: Error & { status?: number }) => error.status === 501);
});

test("nodes on a c9s host start by node name, and cannot be paused", async (t) => {
  const host = await fakeC9sHost(t);
  const lab = backend(host);
  await lab.nodeAction("demo", "demo-n1", "restart");
  const restart = (await host.calls()).find((call) => call.startsWith("restart"));
  assert.equal(restart, `restart -r c9s -t ${host.topology} -n n1 | ns=team-a ctx=kind-c9s-app`);
  await assert.rejects(lab.nodeAction("demo", "demo-n1", "pause"), (error: Error & { status?: number }) => error.status === 501);
});

test("a terminal on a c9s node execs in the pod and container inspect reports", async (t) => {
  const host = await fakeC9sHost(t);
  const execs: unknown[] = [];
  const client: KubeClient = {
    async exec(request) {
      execs.push({ namespace: request.namespace, pod: request.pod, container: request.container, command: request.command });
      (request.stdout as Writable).write("ready\r\n");
      return { close() {} };
    },
    portForward: async () => ({ close() {} }),
    hasMetricsApi: async () => false,
    podMetrics: async () => []
  };
  const lab = backend(host, {}, client);
  const session = await lab.createTerminal("demo", "demo-n1", { protocol: "shell", cols: 100, rows: 30 });
  const terminal = await lab.attachTerminal(session.sessionId);
  const output = await new Promise<string>((resolve) =>
    terminal.onMessage((message) => {
      if (message.type === "output") resolve(Buffer.from(message.data, "base64").toString());
    })
  );
  assert.equal(output, "ready\r\n");
  assert.deepEqual(execs, [{ namespace: "team-a", pod: "demo-n1-pod", container: "node-n1-abc", command: ["sh"] }]);
  terminal.close();
  assert.equal((await lab.features()).nodeStats, false);
  await lab.dispose();
});

test("c9s events reach clients as containerlab reports them", async (t) => {
  const host = await fakeC9sHost(t);
  const lab = backend(host);
  const events: LabEvent[] = [];
  for await (const event of await lab.events({ initialState: true }, new AbortController().signal)) events.push(event);
  // containerlab reports Docker's actions, states and node labels, and the deployed file as `clab-topo-file`.
  assert.deepEqual(events, c9sEvents(host.topology));
  assert.equal((await host.calls())[0], "events -r c9s --format json --initial-state | ns= ctx=kind-c9s-app");
});

test("capture on a c9s host lists lab-link interfaces and streams containerlab capture", async (t) => {
  const host = await fakeC9sHost(t);
  const lab = backend(host);
  assert.equal((await lab.features()).captureStream, true);
  assert.deepEqual(await lab.captureInterfaces("demo"), [
    { node: "n1", interface: "eth1", peerNode: "n2", peerInterface: "eth1" }
  ]);
  const chunks: Uint8Array[] = [];
  const stream = await lab.openCaptureStream("demo", {
    targets: [{ containerName: "demo-n1", interfaceName: "eth1" }],
    duration: "5s",
    signal: new AbortController().signal
  });
  for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), CAPTURE);
  const calls = (await host.calls()).filter((call) => call.includes("capture"));
  assert.deepEqual(calls, [
    "-r c9s capture --name demo --list -f json | ns=team-a ctx=kind-c9s-app",
    "-r c9s capture --name demo --target n1:eth1 --duration 5s -w - | ns=team-a ctx=kind-c9s-app"
  ]);
  const { command, env } = await lab.captureCommandLine("demo", [{ containerName: "demo-n1", interfaceName: "eth1" }]);
  assert.equal(command, `${host.binary} -r c9s capture --name demo --target n1:eth1 -w -`);
  assert.deepEqual(env, { CLAB_KUBE_CONTEXT: "kind-c9s-app", CLAB_KUBE_NAMESPACE: "team-a" });
});

test("capture streams are a c9s feature; Docker hosts keep Edgeshark", async (t) => {
  const host = await fakeC9sHost(t);
  const docker = new LocalLabBackend({ binaryPath: host.binary, workspaceRoot: host.workspace });
  assert.equal((await docker.features()).captureStream, false);
  const notOnDocker = (error: Error & { status?: number }) => error.status === 501;
  await assert.rejects(docker.captureInterfaces("demo"), notOnDocker);
  await assert.rejects(
    docker.openCaptureStream("demo", { targets: [], signal: new AbortController().signal }),
    notOnDocker
  );
});

test("inspect interfaces on a c9s host asks by lab and node name", async (t) => {
  const host = await fakeC9sHost(t);
  const lab = backend(host);
  assert.equal((await lab.features()).interfaceInspect, true);
  const interfaces = await lab.inspectInterfaces(host.topology, "demo-n1");
  assert.equal((interfaces[0] as { name: string }).name, "demo-n1");
  const call = (await host.calls()).find((entry) => entry.startsWith("inspect interfaces"));
  assert.equal(call, "inspect interfaces -r c9s --name demo -f json -n n1 | ns=team-a ctx=kind-c9s-app");
});

test("a c9s host has no images to manage and says why, without running a `c9s` command", async (t) => {
  const host = await fakeC9sHost(t);
  const lab = backend(host);
  const refused = (error: Error & { status?: number }) =>
    error.status === 501 && /not supported on a Kubernetes lab host/.test(error.message) && !/c9s was not found/.test(error.message);
  await assert.rejects(lab.listImages(), refused);
  await assert.rejects(lab.pullImage("alpine:3"), refused);
  await assert.rejects(lab.removeImage("alpine:3"), refused);
  assert.equal((await lab.features()).imageManagement, false);
});

test("the lab's settings reach deploy, apply and its plan, and destroy takes its part", async (t) => {
  const host = await fakeC9sHost(t);
  const lab = backend(host);
  const settings = { timeout: "30m", maxWorkers: 3, namespace: "team-b", noTopologyCR: true };
  const target = { labName: "demo", path: "demo/demo.clab.yml" };
  await lab.runLifecycle("deploy", target, { lifecycleOptions: settings });
  await lab.runLifecycle("apply", target, { dryRun: true, lifecycleOptions: settings });
  await lab.runLifecycle("destroy", { labName: "demo" }, { lifecycleOptions: { timeout: "30m", namespace: "team-b" } });
  const calls = (await host.calls()).filter((call) => !call.startsWith("inspect"));
  const topology = path.join(host.workspace, "demo", "demo.clab.yml");
  assert.deepEqual(calls, [
    `deploy -r c9s --name demo --timeout 30m --max-workers 3 --namespace team-b --no-topology-cr -t ${topology} | ns=team-a ctx=kind-c9s-app`,
    `deploy -r c9s --dry-run --timeout 30m --max-workers 3 --namespace team-b --no-topology-cr --format json -t ${topology} | ns=team-a ctx=kind-c9s-app`,
    `destroy -r c9s --timeout 30m --namespace team-b -t ${topology} | ns=team-a ctx=kind-c9s-app`
  ]);
});
