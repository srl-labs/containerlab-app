import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import type { CaptureStreamOptions, LabBackend } from "@srl-labs/containerlab-lab-backend";

import { createStandaloneApp } from "./app";
import { captureFileName } from "./captureStreamProxy";
import { createLocalUiStore } from "./localUiStore";

const RECORDS = [
  { name: "demo-n1", nodeName: "n1", labPath: "k8s://c9s-demo/topologies/demo" },
  { name: "demo-n2", nodeName: "n2", labPath: "k8s://c9s-demo/topologies/demo" }
];

/** A c9s lab host with one running lab, whose capture writes two chunks. */
function fakeC9sBackend(calls: { method: string; options?: Omit<CaptureStreamOptions, "signal"> & { aborted?: () => boolean } }[]) {
  return {
    kind: "local",
    scope: "local-c9s:test",
    async inspectAll() {
      return { demo: RECORDS };
    },
    async inspectLab() {
      return RECORDS;
    },
    async listTopologies() {
      return [];
    },
    async captureInterfaces(labName: string) {
      calls.push({ method: `captureInterfaces ${labName}` });
      return [{ node: "n1", interface: "eth1", peerNode: "n2", peerInterface: "eth1" }];
    },
    async openCaptureStream(labName: string, options: CaptureStreamOptions) {
      const { signal, onGap: _onGap, ...rest } = options;
      calls.push({ method: `openCaptureStream ${labName}`, options: { ...rest, aborted: () => signal.aborted } });
      return (async function* () {
        yield new Uint8Array([1, 2, 3, 4]);
        yield new Uint8Array([5, 6, 7, 8]);
      })();
    }
  } as unknown as LabBackend;
}

async function createApp(t: TestContext, localWireshark?: { binaryPath?: string }) {
  const calls: Parameters<typeof fakeC9sBackend>[0] = [];
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "capture-proxy-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const app = await createStandaloneApp({
    isDev: true,
    logger: false,
    viteDevUrl: "http://vite.test",
    ...(localWireshark ? { localWireshark } : {}),
    localEndpoint: {
      backend: fakeC9sBackend(calls),
      ui: createLocalUiStore({ clabDirectory: workspaceRoot, workspaceRoot }),
      status: async () => ({ available: true, problems: [], label: "Cluster", username: "alice" })
    }
  });
  t.after(() => app.close());
  const added = await app.inject({ method: "POST", url: "/auth/endpoints/add", payload: { kind: "local" } });
  const header = added.headers["set-cookie"];
  const cookie = (Array.isArray(header) ? header[0] : header ?? "").split(";")[0];
  const endpointId = added.json<{ id: string }>().id;
  return { app, calls, cookie, endpointId, workspaceRoot };
}

const TOPOLOGY = { labName: "demo", yamlPath: "demo/demo.clab.yml" };

test("capture interfaces of a lab come from its lab host", async (t) => {
  const { app, calls, cookie, endpointId } = await createApp(t);
  const response = await app.inject({
    method: "POST",
    url: "/api/runtime/lab-operations/capture-interfaces",
    headers: { cookie },
    payload: { endpointId, topologyRef: TOPOLOGY }
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), [{ node: "n1", interface: "eth1", peerNode: "n2", peerInterface: "eth1" }]);
  assert.deepEqual(calls.map((call) => call.method), ["captureInterfaces demo"]);
});

test("a capture download is a single-use URL that streams the pcapng as an attachment", async (t) => {
  const { app, calls, cookie, endpointId } = await createApp(t);
  const refused = await app.inject({
    method: "POST",
    url: "/api/runtime/capture/downloads",
    headers: { cookie },
    payload: { endpointId, topologyRef: TOPOLOGY, targets: [{ containerName: "demo-n1", interfaceName: "eth1" }] }
  });
  assert.equal(refused.statusCode, 400, "a download needs an end");

  const created = await app.inject({
    method: "POST",
    url: "/api/runtime/capture/downloads",
    headers: { cookie },
    payload: {
      endpointId,
      topologyRef: TOPOLOGY,
      targets: [
        { containerName: "n1", interfaceName: "eth1" },
        { containerName: "demo-n2", interfaceName: "eth1" }
      ],
      duration: "5s"
    }
  });
  assert.equal(created.statusCode, 201, created.body);
  const { url, fileName } = created.json<{ url: string; fileName: string }>();
  assert.match(url, /^\/api\/runtime\/capture\/downloads\/[0-9a-f]{32}$/);
  assert.match(fileName, /^demo-\d{8}T\d{6}Z\.pcapng$/);
  assert.equal(calls.length, 0, "nothing is captured before the download starts");

  const stranger = await app.inject({ url });
  assert.equal(stranger.statusCode, 404, "another browser session cannot use it");

  const created2 = await app.inject({
    method: "POST",
    url: "/api/runtime/capture/downloads",
    headers: { cookie },
    payload: { endpointId, topologyRef: TOPOLOGY, targets: [{ containerName: "demo-n1", interfaceName: "eth1" }], packetLimit: 10 }
  });
  const download = await app.inject({ url: created2.json<{ url: string }>().url, headers: { cookie } });
  assert.equal(download.statusCode, 200, download.body);
  assert.equal(download.headers["content-type"], "application/x-pcapng");
  assert.match(String(download.headers["content-disposition"]), /^attachment; filename="demo-\d{8}T\d{6}Z\.pcapng"$/);
  assert.deepEqual([...download.rawPayload], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(calls[0].method, "openCaptureStream demo");
  assert.deepEqual(
    { targets: calls[0].options?.targets, packetLimit: calls[0].options?.packetLimit },
    { targets: [{ containerName: "demo-n1", interfaceName: "eth1" }], packetLimit: 10 }
  );

  const again = await app.inject({ url: created2.json<{ url: string }>().url, headers: { cookie } });
  assert.equal(again.statusCode, 404, "used once");
});

test("local Wireshark is only offered by an app that enables it, and gets the stream", async (t) => {
  const plain = await createApp(t);
  const refused = await plain.app.inject({
    method: "POST",
    url: "/api/runtime/capture/local-wireshark",
    headers: { cookie: plain.cookie },
    payload: { endpointId: plain.endpointId, topologyRef: TOPOLOGY, targets: [{ containerName: "demo-n1", interfaceName: "eth1" }] }
  });
  assert.equal(refused.statusCode, 501);
  assert.equal("localWireshark" in (await plain.app.inject({ url: "/api/config", headers: { cookie: plain.cookie } })).json<object>(), false);

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fake-wireshark-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const binary = path.join(directory, "wireshark");
  await fs.writeFile(
    binary,
    `#!${process.execPath}\nconst fs=require("node:fs");fs.writeFileSync(${JSON.stringify(directory)}+"/args.json",JSON.stringify(process.argv.slice(2)));const c=[];process.stdin.on("data",(d)=>c.push(d));process.stdin.on("end",()=>{fs.writeFileSync(${JSON.stringify(directory)}+"/stdin.bin",Buffer.concat(c));process.exit(0)});\n`,
    { mode: 0o755 }
  );
  const desktop = await createApp(t, { binaryPath: binary });
  assert.equal((await desktop.app.inject({ url: "/api/config", headers: { cookie: desktop.cookie } })).json<{ localWireshark?: boolean }>().localWireshark, true);
  const launched = await desktop.app.inject({
    method: "POST",
    url: "/api/runtime/capture/local-wireshark",
    headers: { cookie: desktop.cookie },
    payload: { endpointId: desktop.endpointId, topologyRef: TOPOLOGY, targets: [{ containerName: "demo-n1", interfaceName: "eth1" }] }
  });
  assert.equal(launched.statusCode, 201, launched.body);
  assert.equal(launched.json<{ title: string }>().title, "demo: demo-n1:eth1");
  const stdin = path.join(directory, "stdin.bin");
  for (let attempt = 0; attempt < 100 && !(await fs.stat(stdin).catch(() => undefined)); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.deepEqual([...(await fs.readFile(stdin))], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, "args.json"), "utf8")), [
    "-k",
    "-i",
    "-",
    "-o",
    "gui.window_title:demo: demo-n1:eth1"
  ]);
});

test("capture files are named after the lab and the UTC time", () => {
  assert.equal(captureFileName("demo", new Date("2026-10-27T14:05:09.123Z")), "demo-20261027T140509Z.pcapng");
  assert.equal(captureFileName("a/b c", new Date("2026-10-27T14:05:09Z")), "a_b_c-20261027T140509Z.pcapng");
});
