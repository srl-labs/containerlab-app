import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import undici, { Response } from "undici";

import { ApiLabBackend } from "./apiLabBackend.ts";

interface RecordedRequest {
  url: URL;
  method: string;
  body?: unknown;
}

/** Answers like a clab-api-server that lists `features` on `/health`. */
function mockServer(
  t: test.TestContext,
  options: { features?: string[]; missingRoutes?: RegExp; health?: Record<string, unknown> } = {}
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  t.mock.method(undici, "fetch", (input: unknown, init: { method?: string; body?: string } = {}) => {
    const url = new URL(String(input));
    requests.push({
      url,
      method: init.method ?? "GET",
      ...(init.body ? { body: JSON.parse(init.body) as unknown } : {})
    });
    if (url.pathname === "/health") {
      const health = {
        status: "healthy",
        ...(options.features ? { features: options.features } : {}),
        ...options.health
      };
      return Promise.resolve(Response.json(health));
    }
    if (options.missingRoutes?.test(url.pathname)) {
      return Promise.resolve(new Response("404 page not found", { status: 404 }));
    }
    return Promise.resolve(Response.json({ message: "ok", link: "https://sshx.io/s/a#r,w" }));
  });
  return requests;
}

const NEW_SERVER = ["validate", "graph-mermaid", "graph-dot", "sshx-readers", "gotty-options"];

const DOCKER_RUNTIME_FEATURES = {
  imageManagement: true,
  netem: true,
  snapshots: true,
  nodePause: true,
  fcli: true,
  interfaceInspect: true,
  edgeshark: true,
  hostMetrics: true,
  tailscale: true,
  shareTools: true,
  hostCapture: true,
  manifestExport: false,
  c9sDeployOptions: false,
  captureStream: false,
  captureVnc: false
};

test("the lab runtime comes from /health; a server without one is an old Docker server", async (t) => {
  mockServer(t, { features: NEW_SERVER, health: { runtime: "c9s", namespaceMode: "per-lab" } });
  const c9s = new ApiLabBackend({ baseUrl: "https://c9s.test", token: "token" });
  assert.deepEqual(await c9s.hostProfile(), { runtime: "c9s", namespaceMode: "per-lab" });
  const features = await c9s.features();
  for (const flag of ["imageManagement", "netem", "snapshots", "nodePause", "fcli", "interfaceInspect", "edgeshark"] as const) {
    assert.equal(features[flag], false, flag);
  }
  assert.equal(features.c9sDeployOptions, false);
  assert.equal(features.sshxReaders, true);

  t.mock.restoreAll();
  mockServer(t, { features: NEW_SERVER, health: { runtime: "podman" } });
  const podman = new ApiLabBackend({ baseUrl: "https://podman.test", token: "token" });
  assert.deepEqual(await podman.hostProfile(), { runtime: "podman" });
  assert.equal((await podman.features()).netem, true);

  t.mock.restoreAll();
  mockServer(t, { features: NEW_SERVER });
  const old = new ApiLabBackend({ baseUrl: "https://old-runtime.test", token: "token" });
  const profile = await old.hostProfile();
  assert.equal(profile.runtime, "docker");
  assert.match(profile.updateRequired ?? "", /does not report its lab runtime\. Update it to 0\.10\.0 or later/);
  // Docker keeps working on it; nothing c9s is offered.
  assert.equal((await old.features()).imageManagement, true);
  assert.equal((await old.features()).c9sDeployOptions, false);

  t.mock.restoreAll();
  mockServer(t, { health: { runtime: "lxd" } });
  const unknown = new ApiLabBackend({ baseUrl: "https://lxd.test", token: "token" });
  await assert.rejects(unknown.hostProfile(), /runs labs with "lxd"/);
});

test("a c9s server with lab-host-info adds its cluster and deploy settings; a failing one leaves /health's profile", async (t) => {
  const requests: RecordedRequest[] = [];
  t.mock.method(undici, "fetch", (input: unknown) => {
    const url = new URL(String(input));
    requests.push({ url, method: "GET" });
    if (url.pathname === "/health") {
      return Promise.resolve(
        Response.json({ features: [...NEW_SERVER, "lab-host-info"], runtime: "c9s", namespaceMode: "per-lab" })
      );
    }
    return Promise.resolve(
      Response.json({
        runtime: "c9s",
        c9s: {
          context: "c9s-provisioner",
          cluster: "c9s",
          namespacePattern: "c9s-alice-{lab}",
          sharedNamespacePattern: "c9s-shared-{lab}",
          exposeType: "None",
          persistence: true,
          imagePullSecret: "",
          labQuota: false,
          metrics: false
        }
      })
    );
  });
  const backend = new ApiLabBackend({ baseUrl: "https://c9s-info.test", token: "token" });
  assert.deepEqual(await backend.hostProfile(), {
    runtime: "c9s",
    namespaceMode: "per-lab",
    cluster: "c9s",
    namespacePattern: "c9s-alice-{lab}",
    sharedNamespacePattern: "c9s-shared-{lab}",
    exposeType: "None",
    persistence: true,
    labQuota: false
  });
  await backend.hostProfile();
  assert.equal(requests.filter((request) => request.url.pathname === "/api/v1/lab-host").length, 1, "cached");

  t.mock.restoreAll();
  mockServer(t, { features: [...NEW_SERVER, "lab-host-info"], health: { runtime: "c9s" }, missingRoutes: /lab-host/ });
  const failing = new ApiLabBackend({ baseUrl: "https://c9s-info-old.test", token: "token" });
  assert.deepEqual(await failing.hostProfile(), { runtime: "c9s" });
});

test("an unreachable server is not taken for an old one", async (t) => {
  t.mock.method(undici, "fetch", () => Promise.reject(new TypeError("fetch failed")));
  const backend = new ApiLabBackend({ baseUrl: "https://down.test", token: "token" });
  await assert.rejects(backend.hostProfile(), /fetch failed/);
});

test("Kubernetes manifests are not exported by a clab-api-server", async () => {
  const backend = new ApiLabBackend({ baseUrl: "https://api.test", token: "token" });
  await assert.rejects(backend.exportManifests(), (error: Error & { status?: number }) => error.status === 501);
});

test("features come from the server's health endpoint and older servers list none", async (t) => {
  mockServer(t, { features: NEW_SERVER });
  const current = new ApiLabBackend({ baseUrl: "https://api.test", token: "token" });
  assert.deepEqual(await current.features(), {
    validate: true,
    graphMermaid: true,
    graphDot: true,
    sshxReaders: true,
    gottyOptions: true,
    nodeStats: false,
    terminalResume: false,
    ...DOCKER_RUNTIME_FEATURES
  });

  t.mock.restoreAll();
  mockServer(t);
  // Features are cached per server, so the older server has its own URL.
  const older = new ApiLabBackend({ baseUrl: "https://older.test", token: "token" });
  assert.deepEqual(await older.features(), {
    validate: true,
    graphMermaid: false,
    graphDot: false,
    sshxReaders: false,
    gottyOptions: false,
    nodeStats: false,
    terminalResume: false,
    ...DOCKER_RUNTIME_FEATURES
  });
});

test("graph exports go to the format's endpoint with the topology path", async (t) => {
  const requests = mockServer(t, { features: NEW_SERVER });
  const backend = new ApiLabBackend({ baseUrl: "https://api.test", token: "token" });

  await backend.graphExport({ labName: "demo", path: "demo/demo.clab.yml" }, "mermaid", { direction: "LR" });
  await backend.graphExport({ labName: "demo" }, "dot");

  const [mermaid, dot] = requests.filter((request) => request.url.pathname.includes("/graph/"));
  assert.equal(mermaid.url.pathname, "/api/v1/labs/demo/graph/mermaid");
  assert.equal(mermaid.url.searchParams.get("path"), "demo/demo.clab.yml");
  assert.deepEqual(mermaid.body, { direction: "LR" });
  assert.equal(dot.url.pathname, "/api/v1/labs/demo/graph/dot");
  assert.deepEqual(dot.body, {});
});

test("an older server refuses graph exports and share options before anything runs", async (t) => {
  const requests = mockServer(t);
  const backend = new ApiLabBackend({ baseUrl: "https://older.test", token: "token" });

  await assert.rejects(backend.graphExport({ labName: "demo" }, "dot"), { status: 501 });
  await assert.rejects(backend.shareTool("sshx", "demo", "attach", { enableReaders: true }), {
    status: 501
  });
  await assert.rejects(
    backend.shareTool("gotty", "demo", "attach", { username: "lab", password: "secret" }),
    { status: 501 }
  );
  assert.ok(requests.every((request) => request.url.pathname === "/health"));

  // Plain sharing keeps working.
  await backend.shareTool("gotty", "demo", "attach", { port: 8081 });
  assert.equal(requests.at(-1)?.url.searchParams.get("port"), "8081");
});

test("share options travel in the request body", async (t) => {
  const requests = mockServer(t, { features: NEW_SERVER });
  const backend = new ApiLabBackend({ baseUrl: "https://api.test", token: "token" });

  await backend.shareTool("sshx", "demo", "reattach", { enableReaders: true });
  await backend.shareTool("gotty", "demo", "attach", {
    port: 8081,
    username: "lab",
    password: "secret",
    shell: "sh"
  });
  await backend.shareTool("gotty", "demo", "detach", { username: "lab", password: "secret" });

  const shares = requests.filter((request) => request.url.pathname !== "/health");
  assert.deepEqual(shares[0].body, { enableReaders: true });
  assert.deepEqual(shares[1].body, { username: "lab", password: "secret", shell: "sh" });
  assert.equal(shares[1].url.searchParams.get("port"), "8081");
  assert.deepEqual(shares[2].body, {});

  await assert.rejects(
    backend.shareTool("gotty", "demo", "attach", { username: "lab", password: "a b" }),
    { status: 400 }
  );
});

test("validate on a server without the endpoint asks for an update", async (t) => {
  const requests = mockServer(t, { missingRoutes: /\/validate$/ });
  const backend = new ApiLabBackend({ baseUrl: "https://api.test", token: "token" });

  await assert.rejects(backend.validate({ labName: "demo", path: "demo.clab.yml" }), {
    status: 501,
    message: /does not support topology validation/
  });
  assert.equal(requests[0].url.searchParams.get("path"), "demo.clab.yml");
});

test("generate never deploys or writes on the server", async (t) => {
  const requests = mockServer(t);
  const backend = new ApiLabBackend({ baseUrl: "https://api.test", token: "token" });

  await backend.generateTopology({ name: "clos", tiers: [{ count: 2 }], images: { nokia_srlinux: "srl" } });

  assert.equal(requests[0].url.pathname, "/api/v1/generate");
  assert.deepEqual(requests[0].body, {
    name: "clos",
    tiers: [{ count: 2 }],
    images: { nokia_srlinux: "srl" },
    deploy: false
  });
});

/** Answers streaming requests with NDJSON `lines` and `/health` with `features`. */
function mockStreamServer(t: test.TestContext, features: string[], lines: string[]): URL[] {
  const urls: URL[] = [];
  t.mock.method(undici, "fetch", (input: unknown) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.pathname === "/health") return Promise.resolve(Response.json({ status: "healthy", features }));
    return Promise.resolve(
      new Response(lines.join("\n"), { headers: { "content-type": "application/x-ndjson" } })
    );
  });
  return urls;
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

test("node logs follow the server's NDJSON stream with the stream of each line", async (t) => {
  const urls = mockStreamServer(t, ["log-stream"], [
    JSON.stringify({ containerName: "clab-demo-n1", line: "booting", stream: "stdout" }),
    "",
    JSON.stringify({ containerName: "clab-demo-n1", line: "warn", stream: "stderr" }),
    JSON.stringify({ containerName: "clab-demo-n1", line: "older server" })
  ]);
  const backend = new ApiLabBackend({ baseUrl: "https://logs.test", token: "token" });
  const lines = await collect(
    await backend.streamNodeLogs("demo", "clab-demo-n1", { tail: "100", signal: new AbortController().signal })
  );
  assert.deepEqual(lines, [
    { line: "booting", stream: "stdout" },
    { line: "warn", stream: "stderr" },
    { line: "older server" }
  ]);
  const logs = urls.find((url) => url.pathname.endsWith("/logs"));
  assert.equal(logs?.pathname, "/api/v1/labs/demo/nodes/clab-demo-n1/logs");
  assert.equal(logs?.searchParams.get("follow"), "true");
  assert.equal(logs?.searchParams.get("tail"), "100");
});

test("lab stats need a server that lists node-stats", async (t) => {
  const sample = { type: "stats", time: "2026-01-01T00:00:00Z", intervalSeconds: 2, nodes: [] };
  const urls = mockStreamServer(t, ["node-stats"], [JSON.stringify(sample)]);
  const backend = new ApiLabBackend({ baseUrl: "https://stats.test", token: "token" });
  const samples = await collect(
    await backend.streamLabStats("demo", { intervalSeconds: 5, signal: new AbortController().signal })
  );
  assert.deepEqual(samples, [sample]);
  const stats = urls.find((url) => url.pathname.endsWith("/stats"));
  assert.equal(stats?.searchParams.get("interval"), "5s");

  t.mock.restoreAll();
  mockStreamServer(t, [], []);
  const older = new ApiLabBackend({ baseUrl: "https://stats-older.test", token: "token" });
  await assert.rejects(
    older.streamLabStats("demo", { signal: new AbortController().signal }),
    (error: Error & { status?: number }) => error.status === 501
  );
});

test("a c9s server's apply plan reads like a local c9s host's: Kubernetes changes and node lists", async (t) => {
  // clab-api-server answers a c9s dry run with runtimePlan and empty node lists.
  const plan = {
    dryRun: true,
    deployedLab: false,
    labName: "demo",
    addedNodes: [],
    deletedNodes: [],
    recreatedNodes: [],
    startedNodes: [],
    addedLinks: [],
    deletedEndpoints: [],
    restartedNodes: [],
    nodeChangeReasons: {},
    runtimePlan: {
      namespace: "c9s-alice-demo",
      changes: [
        { action: "update", kind: "Topology", namespace: "c9s-alice-demo", name: "demo" },
        { action: "recreate", kind: "Node", namespace: "c9s-alice-demo", name: "n1" },
        { action: "create", kind: "Node", namespace: "c9s-alice-demo", name: "n3" }
      ]
    }
  };
  t.mock.method(undici, "fetch", (input: unknown) => {
    const url = new URL(String(input));
    if (url.pathname === "/health") return Promise.resolve(Response.json({ status: "healthy", runtime: "c9s", features: [] }));
    return Promise.resolve(Response.json(plan));
  });
  const backend = new ApiLabBackend({ baseUrl: "https://api.test", token: "token" });
  const { result } = await backend.runLifecycle("apply", { labName: "demo", path: "demo/demo.clab.yml" }, { dryRun: true });
  const record = result as Record<string, unknown>;
  assert.equal(record.namespace, "c9s-alice-demo");
  assert.deepEqual(record.changes, plan.runtimePlan.changes);
  assert.deepEqual(record.addedNodes, ["n3"]);
  assert.deepEqual(record.recreatedNodes, ["n1"]);
  assert.equal(record.deployedLab, false);
  assert.deepEqual(record.runtimePlan, plan.runtimePlan);
});

function block(type: number, bodyBytes: number): Uint8Array {
  const length = 12 + Math.ceil(bodyBytes / 4) * 4;
  const data = new Uint8Array(length);
  const view = new DataView(data.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, length, true);
  if (type === 0x0a0d0d0a) view.setUint32(8, 0x1a2b3c4d, true);
  view.setUint32(length - 4, length, true);
  return data;
}

const LAB_RECORDS = [{ name: "demo-n1", nodeName: "n1", lab_name: "demo" }, { name: "demo-n2", lab_name: "demo" }];

/** A c9s clab-api-server with capture: `/health`, the lab's records, tickets and a capture stream. */
function mockCaptureServer(
  t: test.TestContext,
  stream: (signal: AbortSignal | undefined) => ReadableStream<Uint8Array>
): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  t.mock.method(undici, "fetch", (input: unknown, init: { method?: string; body?: string; signal?: AbortSignal } = {}) => {
    const url = new URL(String(input));
    requests.push({ url, method: init.method ?? "GET", ...(init.body ? { body: JSON.parse(init.body) as unknown } : {}) });
    if (url.pathname === "/health") {
      return Promise.resolve(Response.json({ status: "healthy", runtime: "c9s", features: ["capture-stream", "wireshark-vnc"] }));
    }
    if (url.pathname === "/api/v1/labs/demo") return Promise.resolve(Response.json(LAB_RECORDS));
    if (url.pathname === "/api/v1/labs/demo/capture/interfaces") {
      return Promise.resolve(
        Response.json([{ node: "n1", interface: "eth1", peerNode: "n2", peerInterface: "eth1" }])
      );
    }
    if (url.pathname === "/api/v1/labs/demo/capture/tickets") {
      return Promise.resolve(
        Response.json(
          {
            ticket: "t0k3n",
            packetflixUri: "packetflix:wss://api.test/api/v1/capture/packetflix/t0k3n?container=%7B%7D",
            expiresAt: "2026-10-27T14:01:00Z"
          },
          { status: 201 }
        )
      );
    }
    if (url.pathname === "/api/v1/labs/demo/capture/stream") {
      return Promise.resolve(new Response(stream(init.signal), { headers: { "content-type": "application/x-pcapng" } }));
    }
    return Promise.resolve(Response.json({ error: "no route" }, { status: 404 }));
  });
  return requests;
}

test("a c9s server with capture-stream captures; wireshark-vnc there means VNC from its stream", async (t) => {
  mockCaptureServer(t, () => new ReadableStream());
  const backend = new ApiLabBackend({ baseUrl: "https://capture-features.test", token: "token" });
  const features = await backend.features();
  assert.equal(features.captureStream, true);
  assert.equal(features.captureVnc, true);
  assert.equal(features.edgeshark, false);
  assert.equal(backend.capabilities.captureTickets, true);

  t.mock.restoreAll();
  mockServer(t, { features: ["wireshark-vnc"], health: { runtime: "docker" } });
  const docker = new ApiLabBackend({ baseUrl: "https://capture-docker.test", token: "token" });
  assert.equal((await docker.features()).captureVnc, false, "Docker servers feed VNC from Edgeshark");
  await assert.rejects(docker.captureInterfaces("demo"), (error: Error & { status?: number }) => error.status === 501);
});

test("capture interfaces and tickets go to the lab's capture routes with node targets", async (t) => {
  const requests = mockCaptureServer(t, () => new ReadableStream());
  const backend = new ApiLabBackend({ baseUrl: "https://capture-tickets.test", token: "token" });
  assert.deepEqual(await backend.captureInterfaces("demo"), [
    { node: "n1", interface: "eth1", peerNode: "n2", peerInterface: "eth1" }
  ]);
  const ticket = await backend.createCaptureTicket(
    "demo",
    [
      { containerName: "demo-n1", interfaceName: "eth1" },
      { containerName: "demo-n2", interfaceName: "eth1" }
    ],
    { duration: "30s" }
  );
  // The link is opaque: it goes to cshargextcap as the server made it.
  assert.deepEqual(ticket, {
    packetflixUri: "packetflix:wss://api.test/api/v1/capture/packetflix/t0k3n?container=%7B%7D",
    expiresAt: "2026-10-27T14:01:00Z"
  });
  const post = requests.find((request) => request.url.pathname.endsWith("/capture/tickets"));
  assert.equal(post?.method, "POST");
  assert.deepEqual(post?.body, {
    targets: [
      { node: "n1", interface: "eth1" },
      { node: "n2", interface: "eth1" }
    ],
    duration: "30s"
  });
  await assert.rejects(
    backend.createCaptureTicket("demo", [{ containerName: "demo-n1", interfaceName: "eth1" }], { duration: "soon" }),
    (error: Error & { status?: number }) => error.status === 400
  );
});

test("a capture stream yields whole pcapng blocks and an abort ends it cleanly", async (t) => {
  const header = block(0x0a0d0d0a, 16);
  const packet = block(6, 60);
  let cancelled = false;
  let body: ReadableStream<Uint8Array> | undefined;
  const requests = mockCaptureServer(t, (signal) => {
    let sent = 0;
    body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (signal?.aborted) {
          controller.error(new DOMException("aborted", "AbortError"));
          return;
        }
        sent += 1;
        // The header, then packets cut in two, like a network splits them.
        if (sent === 1) controller.enqueue(header);
        else if (sent % 2 === 0) controller.enqueue(packet.slice(0, 20));
        else controller.enqueue(packet.slice(20));
        return new Promise((resolve) => setTimeout(resolve, 2));
      },
      cancel() {
        cancelled = true;
      }
    });
    return body;
  });
  const backend = new ApiLabBackend({ baseUrl: "https://capture-stream.test", token: "token" });
  const controller = new AbortController();
  const stream = await backend.openCaptureStream("demo", {
    targets: [{ containerName: "demo-n1", interfaceName: "eth1" }],
    packetLimit: 100,
    signal: controller.signal
  });
  // Read from the call on: undici cancels the body of a collected Response that nothing reads.
  assert.equal(body?.locked, true);
  let bytes = 0;
  for await (const chunk of stream) {
    // Every chunk is whole blocks.
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let offset = 0; offset < chunk.byteLength; offset += view.getUint32(offset + 4, true)) {
      assert.ok(offset + view.getUint32(offset + 4, true) <= chunk.byteLength);
    }
    bytes += chunk.byteLength;
    if (bytes >= header.byteLength + 3 * packet.byteLength) controller.abort();
  }
  assert.equal((bytes - header.byteLength) % packet.byteLength, 0);
  assert.ok(cancelled || controller.signal.aborted);
  const url = requests.find((request) => request.url.pathname.endsWith("/capture/stream"))?.url;
  assert.deepEqual(url?.searchParams.getAll("target"), ["n1:eth1"]);
  assert.equal(url?.searchParams.get("packetLimit"), "100");
});

test("an events stream that is read later survives garbage collection", async (t) => {
  // undici cancels the body of a garbage-collected Response while nothing reads it. The
  // contract suite opens the events stream, deploys for half a minute and reads it after.
  setFlagsFromString("--expose-gc");
  const gc = runInNewContext("gc") as () => void;
  let stream: http.ServerResponse | undefined;
  let clientLeft = false;
  const server = http.createServer((request, response) => {
    if (request.url === "/health") {
      response.end(JSON.stringify({ status: "healthy" }));
      return;
    }
    stream = response;
    response.writeHead(200, { "Content-Type": "application/x-ndjson" });
    response.write("\n");
    request.on("close", () => {
      clientLeft = true;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const abort = new AbortController();
  t.after(() => {
    abort.abort();
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as AddressInfo;
  const backend = new ApiLabBackend({ baseUrl: `http://127.0.0.1:${port}`, token: "token" });

  const events = await backend.events({ initialState: true }, abort.signal);
  for (let round = 0; round < 5; round += 1) {
    gc();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(clientLeft, false, "the events request is still open");
  stream?.write(`${JSON.stringify({ type: "container", action: "start", actor_name: "lab-n1" })}\n`);
  const first = await events[Symbol.asyncIterator]().next();
  assert.deepEqual(first, { done: false, value: { type: "container", action: "start", actor_name: "lab-n1" } });
});
