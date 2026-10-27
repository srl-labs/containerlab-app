import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import test, { type TestContext } from "node:test";

import type { InspectContainerInfo } from "../../contract/dto.ts";
import { resolveLocalOptions } from "../options.ts";
import { parseC9sInspect, toC9sContainerRecord } from "./inspect.ts";
import { execExitCode, type KubeClient, type KubePodMetrics } from "./kubeClient.ts";
import { cpuCores, KubeNodeAccess, memoryBytes } from "./kubeNodeAccess.ts";

const RECORD = {
  name: "demo-n1",
  container_id: "c9s-demo/demo/n1",
  image: "ghcr.io/srl-labs/alpine",
  kind: "linux",
  state: "running",
  ipv4_address: "10.244.0.12",
  lab_name: "demo",
  labPath: "demo.clab.yml",
  absLabPath: "/home/alice/labs/demo.clab.yml",
  owner: "alice",
  namespace: "c9s-demo",
  pod: "demo-n1-7c9d8f-abcde",
  container: "node-n1-1a2b3c",
  node_uid: "6f1e3c1a-0000-4000-8000-000000000001",
  exposed_ports: [
    { exposePort: 22, destinationPort: 22, protocol: "TCP" },
    { exposePort: 60080, destinationPort: 80, protocol: "TCP" },
    { exposePort: 161, destinationPort: 161, protocol: "UDP" }
  ],
  load_balancer_address: ""
};

test("c9s inspect records keep where the node runs", () => {
  const record = toC9sContainerRecord(RECORD, "demo");
  assert.equal(record.nodeName, "n1");
  assert.equal(record.container_id, "c9s-demo/demo/n1");
  assert.equal(record.namespace, "c9s-demo");
  assert.equal(record.pod, "demo-n1-7c9d8f-abcde");
  assert.equal(record.container, "node-n1-1a2b3c");
  assert.equal(record.node_uid, RECORD.node_uid);
  assert.equal(record.absLabPath, "/home/alice/labs/demo.clab.yml");
  assert.deepEqual(record.exposed_ports, [
    { exposePort: 22, destinationPort: 22, protocol: "TCP" },
    { exposePort: 60080, destinationPort: 80, protocol: "TCP" },
    { exposePort: 161, destinationPort: 161, protocol: "UDP" }
  ]);
  assert.equal(record.ipv6_address, "N/A");
});

test("exposed ports are read in clabernetes' shape and snake_case; bad ones are dropped", () => {
  const record = toC9sContainerRecord(
    {
      name: "demo-n2",
      exposed_ports: {
        loadBalancerAddress: "192.0.2.10",
        ports: [{ expose_port: "2022", destination_port: 22, protocol: "tcp" }, { exposePort: 0 }, "x"]
      },
      load_balancer_address: "192.0.2.10"
    },
    "demo"
  );
  assert.deepEqual(record.exposed_ports, [{ exposePort: 2022, destinationPort: 22, protocol: "TCP" }]);
  assert.equal(record.load_balancer_address, "192.0.2.10");
  assert.equal(record.lab_name, "demo");
  assert.equal(record.nodeName, "n2");
});

test("inspect output is grouped by lab and sorted; banners before the JSON are skipped", () => {
  const labs = parseC9sInspect(
    `WARN some notice\n${JSON.stringify({
      demo: [{ ...RECORD, name: "demo-n2", pod: "p2" }, RECORD],
      empty: [],
      junk: "x"
    })}`
  );
  assert.deepEqual(Object.keys(labs), ["demo"]);
  assert.deepEqual(
    labs.demo.map((node) => node.name),
    ["demo-n1", "demo-n2"]
  );
  assert.deepEqual(parseC9sInspect("no labs"), {});
});

test("Kubernetes quantities convert to cores and bytes", () => {
  assert.equal(cpuCores("250m"), 0.25);
  assert.equal(cpuCores("1"), 1);
  assert.equal(cpuCores("1500000n"), 0.0015);
  assert.equal(memoryBytes("128Mi"), 134_217_728);
  assert.equal(memoryBytes("1000k"), 1_000_000);
  assert.equal(memoryBytes("bogus"), 0);
});

test("an exec's status gives its exit code", () => {
  assert.deepEqual(execExitCode({ status: "Success" }), { exitCode: 0 });
  assert.deepEqual(
    execExitCode({ status: "Failure", details: { causes: [{ reason: "ExitCode", message: "3" }] } }),
    { exitCode: 3 }
  );
  assert.deepEqual(execExitCode({ status: "Failure", message: "container not found" }), {
    exitCode: null,
    error: "container not found"
  });
});

interface FakeKube {
  client: KubeClient;
  execs: Array<{ namespace: string; pod: string; container: string; command: string[]; tty: boolean }>;
  forwards: Array<{ namespace: string; pod: string; port: number }>;
  closed: () => number;
  resizes: Array<[number, number]>;
  exit(code: number | null): void;
  pods: KubePodMetrics[];
  metricsApi: boolean;
}

/** A cluster whose exec echoes input and whose port-forwards echo bytes back with a prefix. */
function fakeKube(): FakeKube {
  let closed = 0;
  let onExit: ((code: number | null) => void) | undefined;
  const fake: FakeKube = {
    execs: [],
    forwards: [],
    resizes: [],
    closed: () => closed,
    exit: (code) => onExit?.(code),
    pods: [],
    metricsApi: true,
    client: {
      async exec(request) {
        fake.execs.push({
          namespace: request.namespace,
          pod: request.pod,
          container: request.container,
          command: request.command,
          tty: request.tty
        });
        const stdout = request.stdout as Writable & { columns: number; rows: number; on: Writable["on"] };
        fake.resizes.push([stdout.columns, stdout.rows]);
        stdout.on("resize", () => fake.resizes.push([stdout.columns, stdout.rows]));
        (request.stdin as Readable).on("data", (chunk: Buffer) => stdout.write(`echo:${chunk.toString()}`));
        onExit = (code) => request.onExit(code);
        return { close: () => void (closed += 1) };
      },
      async portForward(request) {
        fake.forwards.push({ namespace: request.namespace, pod: request.pod, port: request.port });
        request.input.on("data", (chunk: Buffer) => request.output.write(`pod:${chunk.toString()}`));
        return { close: () => void (closed += 1) };
      },
      hasMetricsApi: async () => fake.metricsApi,
      podMetrics: async () => fake.pods
    }
  };
  return fake;
}

async function fakeContainerlab(t: TestContext, stdout: string): Promise<{ binary: string; args: () => Promise<string[]> }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kube-access-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const binary = path.join(directory, "containerlab");
  await fs.writeFile(directory + "/out.json", stdout);
  await fs.writeFile(
    binary,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${directory}/args"\ncat "${directory}/out.json"\n`,
    { mode: 0o755 }
  );
  return {
    binary,
    args: async () => (await fs.readFile(path.join(directory, "args"), "utf8")).trim().split("\n")
  };
}

function access(fake: FakeKube, binaryPath = "/nonexistent/containerlab") {
  const options = resolveLocalOptions({ runtime: "c9s", binaryPath, env: { PATH: "/usr/bin:/bin" }, c9s: { kubeContext: "kind-c9s-app" } });
  return new KubeNodeAccess(options, () => fake.client);
}

const TARGET = {
  labName: "demo",
  nodeName: "n1",
  containerId: RECORD.container_id,
  kind: "linux",
  ipv4Address: RECORD.ipv4_address,
  namespace: RECORD.namespace,
  pod: RECORD.pod,
  container: RECORD.container
};

test("terminals exec with a TTY in the device container that inspect names", async () => {
  const fake = fakeKube();
  const nodes = access(fake);
  const output: string[] = [];
  const exits: Array<number | null> = [];
  const process = await nodes.exec(TARGET, ["sh"], { cols: 100, rows: 30 }, {
    output: (data) => output.push(data.toString()),
    exit: (code) => exits.push(code)
  });
  assert.deepEqual(fake.execs, [
    { namespace: "c9s-demo", pod: "demo-n1-7c9d8f-abcde", container: "node-n1-1a2b3c", command: ["sh"], tty: true }
  ]);
  process.write("ls\r");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(output, ["echo:ls\r"]);
  process.resize(120, 40);
  assert.deepEqual(fake.resizes, [
    [100, 30],
    [120, 40]
  ]);
  fake.exit(0);
  fake.exit(1);
  assert.deepEqual(exits, [0], "the exit is reported once");
  process.kill();
  assert.equal(fake.closed(), 1);
  // Killed again, e.g. when VS Code shuts down after the terminal closed: no write after end.
  process.kill();
  process.write("ls\r");
  await new Promise((resolve) => setImmediate(resolve));
});

test("a node without its pod in inspect is refused with what to update", async () => {
  const nodes = access(fakeKube());
  await assert.rejects(
    nodes.exec({ ...TARGET, pod: undefined }, ["sh"], { cols: 80, rows: 24 }, { output() {}, exit() {} }),
    /did not report the pod of node "n1"\. Update containerlab/
  );
});

test("SSH goes through a port-forward to port 22, or to the load balancer", async () => {
  const fake = fakeKube();
  const nodes = access(fake);
  const viaForward = await nodes.sshEndpoint(TARGET);
  assert.ok("sock" in viaForward);
  assert.deepEqual(fake.forwards, [{ namespace: "c9s-demo", pod: RECORD.pod, port: 22 }]);
  const reply = new Promise<string>((resolve) => viaForward.sock.once("data", (chunk: Buffer) => resolve(chunk.toString())));
  viaForward.sock.write("SSH-2.0-test");
  assert.equal(await reply, "pod:SSH-2.0-test");
  viaForward.sock.destroy();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fake.closed(), 1, "the port-forward ends with the SSH connection");

  const viaBalancer = await nodes.sshEndpoint({
    ...TARGET,
    loadBalancerAddress: "192.0.2.10",
    exposedPorts: [{ exposePort: 2022, destinationPort: 22, protocol: "TCP" }]
  });
  assert.deepEqual(viaBalancer, { host: "192.0.2.10", port: 2022 });
  await nodes.dispose();
});

test("browser ports open local port-forwards that dispose closes", async () => {
  const fake = fakeKube();
  const nodes = access(fake);
  const container = toC9sContainerRecord(RECORD, "demo") as unknown as InspectContainerInfo;
  const ports = await nodes.browserPorts(container);
  assert.deepEqual(
    ports.map((entry) => [entry.hostIp, entry.containerPort, entry.description]),
    [
      ["127.0.0.1", 22, "SSH"],
      ["127.0.0.1", 80, "HTTP"]
    ]
  );
  const http = ports[1];
  // The same port reuses its listener.
  assert.equal((await nodes.browserPorts(container))[1].hostPort, http.hostPort);
  const answer = await new Promise<string>((resolve, reject) => {
    const socket = net.connect(http.hostPort, "127.0.0.1", () => socket.write("GET /"));
    socket.once("data", (chunk) => {
      resolve(chunk.toString());
      socket.destroy();
    });
    socket.once("error", reject);
  });
  assert.equal(answer, "pod:GET /");
  assert.deepEqual(fake.forwards.at(-1), { namespace: "c9s-demo", pod: RECORD.pod, port: 80 });

  await nodes.dispose();
  await assert.rejects(
    new Promise((resolve, reject) => {
      const socket = net.connect(http.hostPort, "127.0.0.1", () => resolve(socket));
      socket.once("error", reject);
    }),
    /ECONNREFUSED/
  );
});

test("browser ports on a load balancer need no port-forward", async () => {
  const fake = fakeKube();
  const nodes = access(fake);
  const container = toC9sContainerRecord({ ...RECORD, load_balancer_address: "192.0.2.10" }, "demo");
  const ports = await nodes.browserPorts(container as unknown as InspectContainerInfo);
  assert.deepEqual(
    ports.map((entry) => [entry.hostIp, entry.hostPort, entry.containerPort]),
    [
      ["192.0.2.10", 22, 22],
      ["192.0.2.10", 60080, 80]
    ]
  );
  assert.deepEqual(fake.forwards, []);
});

test("node stats come from the device container's pod metrics", async (t) => {
  const fake = fakeKube();
  fake.pods = [
    {
      pod: RECORD.pod,
      containers: [
        { name: "clabwire", cpu: "5m", memory: "10Mi" },
        { name: RECORD.container, cpu: "250m", memory: "128Mi" }
      ]
    }
  ];
  const clab = await fakeContainerlab(t, JSON.stringify({ demo: [RECORD, { ...RECORD, name: "demo-n2", pod: "gone" }] }));
  const nodes = access(fake, clab.binary);
  assert.equal(await nodes.statsAvailable(), true);
  const controller = new AbortController();
  const samples = nodes.labStats("demo", 1, controller.signal)[Symbol.asyncIterator]();
  const first = await samples.next();
  controller.abort();
  assert.deepEqual(first.value?.nodes, [{ name: "demo-n1", nodeName: "n1", cpuPercent: 25, memoryBytes: 134_217_728 }]);
  assert.deepEqual(await clab.args(), ["inspect", "-r", "c9s", "--all", "--format", "json"]);
});

test("without metrics.k8s.io there are no stats", async () => {
  const fake = fakeKube();
  fake.metricsApi = false;
  assert.equal(await access(fake).statsAvailable(), false);
  const broken = new KubeNodeAccess(resolveLocalOptions({ runtime: "c9s" }), () => {
    throw new Error("no kubeconfig");
  });
  assert.equal(await broken.statsAvailable(), false);
});

test("logs come from containerlab logs for the node", async (t) => {
  const clab = await fakeContainerlab(t, "2026-10-27T10:00:00Z booted\n");
  const nodes = access(fakeKube(), clab.binary);
  const container = toC9sContainerRecord(RECORD, "demo") as unknown as InspectContainerInfo;
  const logs = await nodes.nodeLogs(container, "50");
  assert.deepEqual(logs, { containerName: "demo-n1", logs: "2026-10-27T10:00:00Z booted\n" });
  assert.deepEqual(await clab.args(), ["logs", "-r", "c9s", "--name", "demo", "-n", "n1", "--tail", "50", "--timestamps"]);

  const lines = await nodes.streamNodeLogs(container, { tail: "all", signal: new AbortController().signal });
  const collected: string[] = [];
  for await (const line of lines) collected.push(line.line);
  assert.deepEqual(collected, ["2026-10-27T10:00:00Z booted"]);
  assert.deepEqual(await clab.args(), ["logs", "-r", "c9s", "--name", "demo", "-n", "n1", "--timestamps", "--follow"]);
});
