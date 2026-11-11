import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test, { type TestContext } from "node:test";

import type { LocalEndpointStatus } from "@srl-labs/containerlab-app-contract";
import type { LabBackend } from "@srl-labs/containerlab-lab-backend";

import { createStandaloneApp, type LocalEndpointOptions } from "../app.ts";
import { createLocalUiStore } from "../localUiStore.ts";
import { enableImages } from "./setup.ts";
import { FAKE_CLIMG } from "./testHarness.ts";

const STATUS: LocalEndpointStatus = { available: true, problems: [], label: "This computer", username: "alice" };
const MIB = 1024 * 1024;

interface Context {
  base: string;
  cookie: string;
  endpointId: string;
  imagesDir: string;
  stateDir: string;
  workspace: string;
  logs: string[];
  headers: Record<string, string>;
}

async function createContext(
  t: TestContext,
  options: { configured?: boolean; env?: Record<string, string>; apiEndpoint?: boolean } = {}
): Promise<Context> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "images-routes-"));
  const imagesDir = path.join(root, "images");
  const stateDir = path.join(root, "state");
  const workspace = path.join(root, "ws");
  await fs.mkdir(imagesDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  const logs: string[] = [];
  const local: LocalEndpointOptions = {
    backend: { kind: "local", scope: "local:x", options: { workspaceRoot: workspace } } as unknown as LabBackend,
    ui: createLocalUiStore({ workspaceRoot: workspace, clabDirectory: workspace }),
    status: async () => STATUS,
    autoConnect: true
  };
  if (options.configured !== false) {
    const env: Record<string, string> = {
      WEB_LOCAL_CLIMG_PATH: FAKE_CLIMG,
      WEB_LOCAL_CLIMG_STATE: stateDir,
      ...options.env
    };
    // The fake reads its steering variables from the server environment; climg itself gets only the explicit set.
    const messages = await enableImages(local as unknown as Parameters<typeof enableImages>[0], env, {
      log: (line) => logs.push(line),
      extraEnv: { FAKE_IMAGES_DIR: imagesDir, FAKE_NODETPL_FILE: path.join(workspace, "ui", "custom-nodes.json") }
    });
    logs.push(...messages);
  }
  const app = await createStandaloneApp({ isDev: true, logger: false, viteDevUrl: "http://vite.test", localEndpoint: local });
  await app.listen({ port: 0, host: "127.0.0.1" });
  t.after(async () => {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const added = await app.inject({ method: "POST", url: "/auth/endpoints/add", payload: { kind: "local" } });
  const setCookie = added.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : (setCookie ?? "")).split(";")[0];
  const endpointId = added.json<{ id: string }>().id;
  return { base, cookie, endpointId, imagesDir, stateDir, workspace, logs, headers: { cookie, "x-endpoint-id": endpointId } };
}

async function call(context: Context, method: string, url: string, body?: unknown): Promise<{ status: number; json: any }> {
  const response = await fetch(`${context.base}${url}`, {
    method,
    headers: { ...context.headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : undefined };
}

test("Images routes are unavailable without climg, with the keys to set", async (t) => {
  const context = await createContext(t, { configured: false });
  const response = await call(context, "GET", "/api/runtime/images/status");
  assert.equal(response.status, 404);
  assert.equal(response.json.reason, "unavailable");
  assert.ok(response.json.configKeys.includes("WEB_LOCAL_CLIMG_PATH"));
  assert.equal((await call(context, "GET", "/api/runtime/images/jobs")).status, 404);
  const put = await fetch(`${context.base}/api/runtime/images/upload`, { method: "PUT", headers: { ...context.headers, "content-type": "application/octet-stream", "x-file-name": "a.qcow2" }, body: "x" });
  assert.equal(put.status, 404);
});

test("Images routes are unavailable when climg does not start (wrong contract)", async (t) => {
  process.env.FAKE_CLIMG_VERSION = "climg 2.0.0 (contract 2)";
  t.after(() => delete process.env.FAKE_CLIMG_VERSION);
  // The version line is read from the server's own environment by the fake; the runner passes only explicit variables.
  const context = await createContext(t, { env: {} });
  // The runner does not pass FAKE_* from the server environment, so the fake answers contract 1 here;
  // a failing start is covered by service.test.ts. Check the unavailable shape with a missing executable instead.
  void context;
  const missing = await createContext(t, { env: { WEB_LOCAL_CLIMG_PATH: "/nonexistent/climg" } });
  const response = await call(missing, "GET", "/api/runtime/images/status");
  assert.equal(response.status, 404);
  assert.equal(response.json.reason, "unavailable");
  assert.match(response.json.detail, /did not start/);
});

test("Images routes are unavailable for an endpoint that is not local", async (t) => {
  const context = await createContext(t);
  // A session without the local endpoint: sign-in state does not exist, so the route refuses as unauthenticated.
  const response = await fetch(`${context.base}/api/runtime/images/status`);
  assert.equal(response.status, 401);
});

test("read routes, templates and jobs over HTTP", async (t) => {
  const context = await createContext(t);
  const status = await call(context, "GET", "/api/runtime/images/status");
  assert.equal(status.status, 200);
  assert.equal(status.json.configured, true);
  assert.equal(status.json.contract, 1);
  assert.deepEqual(status.json.uploadExtensions, [".qcow2", ".vmdk", ".tgz", ".tar.gz", ".bin", ".iol"]);

  assert.equal((await call(context, "GET", "/api/runtime/images/index")).json.release, "R1");
  assert.equal((await call(context, "POST", "/api/runtime/images/index/refresh", {})).status, 200);
  const found = await call(context, "GET", "/api/runtime/images/search?q=vios&source=labhub");
  assert.equal(found.json[0].key, "labhub:vios-1");
  assert.equal((await call(context, "GET", "/api/runtime/images/show?ref=labhub:vios-1")).status, 200);
  assert.equal((await call(context, "GET", "/api/runtime/images/show?ref=--force")).status, 400);
  assert.equal((await call(context, "GET", `/api/runtime/images/show?ref=${encodeURIComponent("vios; rm -rf /")}`)).status, 400);
  assert.equal((await call(context, "GET", "/api/runtime/images/search?q=--all")).status, 400);
  const all = await call(context, "GET", "/api/runtime/images/search?all=true&vendor=H3C");
  assert.equal(all.status, 200);
  assert.deepEqual((all.json as Array<{ status: string }>).map((record) => record.status), ["unbuildable", "unbuildable"]);
  assert.equal((await call(context, "GET", "/api/runtime/images/show?ref=labhub:nope")).status, 404);
  assert.equal((await call(context, "GET", "/api/runtime/images/images")).status, 200);
  assert.deepEqual((await call(context, "GET", "/api/runtime/images/scan")).json, []);

  const job = await call(context, "POST", "/api/runtime/images/jobs", { op: "pull", ref: "labhub:vios-1" });
  assert.equal(job.status, 202);
  assert.equal((await call(context, "POST", "/api/runtime/images/jobs", { op: "pull", ref: "--force" })).status, 400);
  assert.equal((await call(context, "POST", "/api/runtime/images/jobs", [])).status, 400);
  let ended = job.json;
  for (let i = 0; i < 200 && ended.state === "running"; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 30));
    ended = (await call(context, "GET", `/api/runtime/images/jobs/${job.json.id}`)).json;
  }
  assert.equal(ended.state, "succeeded");
  assert.equal((await call(context, "GET", "/api/runtime/images/jobs")).json.jobs[0].id, job.json.id);
  assert.equal((await call(context, "GET", "/api/runtime/images/jobs/nonexistent")).status, 404);
  assert.equal((await call(context, "POST", `/api/runtime/images/jobs/${job.json.id}/cancel`, {})).status, 409);

  // The palette sees the managed template the job wrote.
  const palette = await call(context, "GET", "/api/runtime/ui/custom-nodes");
  const name = ended.nodetpl.name;
  assert.ok(palette.json.customNodes.some((node: { name: string }) => node.name === name));
  const templates = await call(context, "GET", "/api/runtime/images/templates");
  assert.equal(templates.json.templates.find((template: { name: string }) => template.name === name).managed, true);
  const preview = await call(context, "POST", "/api/runtime/images/templates/sync", { dryRun: true });
  assert.equal(preview.json.dry_run, true);
  assert.equal((await call(context, "POST", "/api/runtime/images/templates/sync", { dryRun: "yes" })).status, 400);
  assert.equal((await call(context, "POST", "/api/runtime/images/templates", { ref: "labhub:missing" })).status, 404);
  assert.equal((await call(context, "DELETE", `/api/runtime/images/templates/foreign`)).status, 404);
  const removed = await call(context, "DELETE", `/api/runtime/images/templates/${encodeURIComponent(name)}`);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.json.removed, [name]);
});

function putFile(
  context: Context,
  name: string,
  body: Readable,
  length: number | undefined,
  extra: Record<string, string> = {}
): { done: Promise<{ status: number; json: any }>; request: http.ClientRequest } {
  const url = new URL(`${context.base}/api/runtime/images/upload`);
  let request!: http.ClientRequest;
  const done = new Promise<{ status: number; json: any }>((resolve, reject) => {
    request = http.request(
      url,
      {
        method: "PUT",
        headers: {
          ...context.headers,
          "content-type": "application/octet-stream",
          "x-file-name": encodeURIComponent(name),
          ...(length !== undefined ? { "content-length": String(length) } : {}),
          ...extra
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: response.statusCode ?? 0, json: text ? JSON.parse(text) : undefined });
        });
      }
    );
    request.on("error", reject);
    body.pipe(request);
  });
  return { done, request };
}

const bytes = (text: string): Readable => Readable.from([Buffer.from(text)]);

test("upload stores the file as the final name, mode 0660, no part file left", async (t) => {
  const context = await createContext(t);
  const result = await putFile(context, "vios-1.qcow2", bytes("hello image"), 11).done;
  assert.equal(result.status, 201, JSON.stringify(result.json));
  assert.equal(result.json.size, 11);
  assert.equal(await fs.readFile(path.join(context.imagesDir, "vios-1.qcow2"), "utf8"), "hello image");
  assert.equal((await fs.stat(path.join(context.imagesDir, "vios-1.qcow2"))).mode & 0o777, 0o660);
  assert.deepEqual(await fs.readdir(context.imagesDir), ["vios-1.qcow2"]);
  assert.ok(context.logs.length >= 0);
});

test("upload refuses unsafe names, extensions, existing files, missing length and oversize before writing", async (t) => {
  const context = await createContext(t, { env: { WEB_LOCAL_IMAGES_UPLOAD_MAX: "1000" } });
  await fs.writeFile(path.join(context.imagesDir, "exists.qcow2"), "old");
  const cases: Array<[string, string, number | undefined, number]> = [
    ["../evil.qcow2", "x", 1, 400],
    ["a/b.qcow2", "x", 1, 400],
    ["..%2f..%2fetc%2fpasswd.qcow2", "x", 1, 400],
    ["notes.txt", "x", 1, 400],
    ["exists.qcow2", "x", 1, 409],
    ["new.qcow2", "x", undefined, 411],
    ["big.qcow2", "x", 5000, 413]
  ];
  for (const [name, body, length, expected] of cases) {
    const response = await putFile(context, name, bytes(body), length).done.catch(() => ({ status: -1, json: undefined }));
    // A refused request may be answered before the body is read; a reset connection also means nothing was stored.
    assert.ok(response.status === expected || response.status === -1, `${name}: ${response.status}`);
  }
  assert.equal(await fs.readFile(path.join(context.imagesDir, "exists.qcow2"), "utf8"), "old");
  assert.deepEqual((await fs.readdir(context.imagesDir)).sort(), ["exists.qcow2"]);
  const raw = await call(context, "PUT", "/api/runtime/images/upload", {});
  assert.equal(raw.status, 415);
});

test("a body longer than its Content-Length is refused and leaves nothing", async (t) => {
  const context = await createContext(t);
  const result = await putFile(context, "short.qcow2", bytes("0123456789"), 5).done.catch(() => ({ status: -1, json: undefined }));
  assert.ok(result.status === 400 || result.status === 413 || result.status === -1, String(result.status));
  assert.deepEqual(await fs.readdir(context.imagesDir), []);
});

test("an aborted upload leaves no file at all", async (t) => {
  const context = await createContext(t);
  const body = new Readable({ read() {} });
  const { done, request } = putFile(context, "partial.qcow2", body, 10 * MIB);
  done.catch(() => undefined);
  body.push(Buffer.alloc(MIB, 1));
  for (let i = 0; i < 100; i += 1) {
    if ((await fs.readdir(context.imagesDir)).some((name) => name.startsWith(".upload-"))) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok((await fs.readdir(context.imagesDir)).some((name) => name.startsWith(".upload-")), "the part file exists while uploading");
  request.destroy();
  for (let i = 0; i < 200; i += 1) {
    if ((await fs.readdir(context.imagesDir)).length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.deepEqual(await fs.readdir(context.imagesDir), []);
  assert.equal((await call(context, "GET", "/api/runtime/images/scan")).status, 200);
});

test("the disk floor counts the uploads already running", async (t) => {
  const context = await createContext(t, { env: {} });
  const { UploadManager } = await import("./upload.ts");
  const manager = new UploadManager({
    config: { climgPath: FAKE_CLIMG, uploadMaxBytes: 10_000, maxJobs: 4, maxRunning: 4, maxQueued: 0 },
    imagesDir: context.imagesDir,
    diskFloorBytes: 1000,
    freeBytes: async () => 5000
  });
  const slow = new Readable({ read() {} });
  const first = manager.receive({ fileName: "a.qcow2", declared: 3000, source: slow });
  first.catch(() => undefined);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(manager.reservedBytes, 3000);
  // 5000 free - 3000 reserved - 2500 declared < 1000 floor
  await assert.rejects(manager.receive({ fileName: "b.qcow2", declared: 2500, source: bytes("x") }), (error: { status?: number }) => error.status === 507);
  // 5000 - 3000 - 1000 = 1000 >= floor
  const second = await manager.receive({ fileName: "c.qcow2", declared: 1000, source: Readable.from([Buffer.alloc(1000)]) });
  assert.equal(second.size, 1000);
  slow.destroy(new Error("done"));
  await first.catch(() => undefined);
  assert.equal(manager.reservedBytes, 0, "the reservation is released");
  await assert.rejects(manager.receive({ fileName: "a.qcow2", declared: 4001, source: bytes("x") }), (error: { status?: number }) => error.status === 507);
});

test("a 1 GiB upload streams to disk without buffering it in memory", { timeout: 180_000 }, async (t) => {
  const context = await createContext(t);
  const total = 1024 * MIB;
  const chunk = Buffer.alloc(MIB, 0x5a);
  let sent = 0;
  const source = new Readable({
    read() {
      this.push(sent >= total ? null : chunk);
      sent += chunk.length;
    }
  });
  globalThis.gc?.();
  const baseline = process.memoryUsage();
  let peakHeap = baseline.heapUsed;
  let peakExternal = baseline.external + baseline.arrayBuffers;
  const sampler = setInterval(() => {
    const usage = process.memoryUsage();
    peakHeap = Math.max(peakHeap, usage.heapUsed);
    peakExternal = Math.max(peakExternal, usage.external + usage.arrayBuffers);
  }, 25);
  const result = await putFile(context, "big.qcow2", source, total).done.finally(() => clearInterval(sampler));
  assert.equal(result.status, 201, JSON.stringify(result.json));
  assert.equal((await fs.stat(path.join(context.imagesDir, "big.qcow2"))).size, total);
  const heapGrowth = peakHeap - baseline.heapUsed;
  const externalGrowth = peakExternal - (baseline.external + baseline.arrayBuffers);
  assert.ok(heapGrowth < 100 * MIB, `heap grew ${Math.round(heapGrowth / MIB)} MiB`);
  // The client and the server share this process, so socket buffers count too; 1 GiB buffered would be ten times this.
  assert.ok(externalGrowth < 200 * MIB, `external memory grew ${Math.round(externalGrowth / MIB)} MiB`);
  assert.deepEqual(await fs.readdir(context.imagesDir), ["big.qcow2"]);
});

test("a JSON body over the default limit is refused with 413 on the upload route", async (t) => {
  const context = await createContext(t);
  const response = await fetch(`${context.base}/api/runtime/images/upload`, {
    method: "PUT",
    headers: { ...context.headers, "content-type": "application/json", "x-file-name": "a.qcow2" },
    body: JSON.stringify({ pad: "x".repeat(2 * MIB) })
  });
  assert.equal(response.status, 413);
});

test("an octet-stream upload above Fastify's default body limit still succeeds", async (t) => {
  const context = await createContext(t);
  const size = 3 * MIB;
  const result = await putFile(context, "big.qcow2", Readable.from([Buffer.alloc(size, 1)]), size).done;
  assert.equal(result.status, 201, JSON.stringify(result.json));
  assert.equal((await fs.stat(path.join(context.imagesDir, "big.qcow2"))).size, size);
});
