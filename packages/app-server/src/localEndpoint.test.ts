import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import type { LocalEndpointStatus } from "@srl-labs/containerlab-app-contract";
import type { LabBackend } from "@srl-labs/containerlab-lab-backend";

import { createStandaloneApp } from "./app";
import { createLocalUiStore } from "./localUiStore";

const AVAILABLE: LocalEndpointStatus = {
  available: true,
  problems: [],
  label: "This computer",
  username: "alice",
  containerlabVersion: "0.78.0"
};

function fakeLocalBackend(calls: string[]): LabBackend {
  return {
    kind: "local",
    scope: "local:/tmp/test",
    async version() {
      calls.push("version");
      return { versionInfo: "version: 0.78.0" };
    },
    async inspectAll() {
      calls.push("inspectAll");
      return { lab1: [] };
    },
    async healthMetrics() {
      calls.push("healthMetrics");
      return { serverInfo: { version: "0.78.0", uptime: "1s", startTime: "" }, metrics: {} };
    }
  } as unknown as LabBackend;
}

async function createApp(t: TestContext, status: LocalEndpointStatus | null) {
  const calls: string[] = [];
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-endpoint-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const app = await createStandaloneApp({
    isDev: true,
    logger: false,
    viteDevUrl: "http://vite.test",
    ...(status
      ? {
          localEndpoint: {
            backend: fakeLocalBackend(calls),
            ui: createLocalUiStore({ clabDirectory: workspaceRoot, workspaceRoot }),
            status: async () => status
          }
        }
      : {})
  });
  t.after(() => app.close());
  return { app, calls };
}

function sessionCookie(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return (header ?? "").split(";")[0];
}

test("/api/config offers the local endpoint only when the app enables it", async (t) => {
  const enabled = await createApp(t, AVAILABLE);
  const config = (await enabled.app.inject("/api/config")).json<{ localEndpoint?: LocalEndpointStatus }>();
  assert.deepEqual(config.localEndpoint, AVAILABLE);

  const disabled = await createApp(t, null);
  assert.equal("localEndpoint" in (await disabled.app.inject("/api/config")).json<object>(), false);
});

test("adding the local endpoint needs no sign-in and reaches the local backend", async (t) => {
  const { app, calls } = await createApp(t, AVAILABLE);
  const added = await app.inject({ method: "POST", url: "/auth/endpoints/add", payload: { kind: "local" } });
  assert.equal(added.statusCode, 200, added.body);
  const endpoint = added.json<{ id: string; kind: string; connected: boolean; label: string; username: string }>();
  assert.equal(endpoint.kind, "local");
  assert.equal(endpoint.connected, true);
  assert.equal(endpoint.label, "This computer");
  assert.equal(endpoint.username, "alice");
  const cookie = sessionCookie(added.headers["set-cookie"]);

  const again = await app.inject({
    method: "POST",
    url: "/auth/endpoints/add",
    headers: { cookie },
    payload: { kind: "local" }
  });
  assert.equal(again.json<{ id: string }>().id, endpoint.id, "a session has one local endpoint");

  const labs = await app.inject({
    url: "/api/runtime/inspect/all",
    headers: { cookie, "x-endpoint-id": endpoint.id }
  });
  assert.equal(labs.statusCode, 200);
  assert.deepEqual(labs.json(), { lab1: [] });
  assert.ok(calls.includes("inspectAll"));

  const metrics = await app.inject({ url: `/auth/endpoints/${endpoint.id}/metrics`, headers: { cookie } });
  assert.equal(metrics.statusCode, 200);

  const config = (await app.inject({ url: "/api/config", headers: { cookie } })).json<{
    endpoints: Array<{ kind: string }>;
  }>();
  assert.deepEqual(
    config.endpoints.map((entry) => entry.kind),
    ["local"]
  );
});

test("the local endpoint is refused when the app does not offer it or containerlab cannot run", async (t) => {
  const disabled = await createApp(t, null);
  const refused = await disabled.app.inject({ method: "POST", url: "/auth/endpoints/add", payload: { kind: "local" } });
  assert.equal(refused.statusCode, 400);

  const unavailable = await createApp(t, {
    ...AVAILABLE,
    available: false,
    problems: ["alice is not in the clab_admins group."]
  });
  const blocked = await unavailable.app.inject({
    method: "POST",
    url: "/auth/endpoints/add",
    payload: { kind: "local" }
  });
  assert.equal(blocked.statusCode, 409);
  assert.match(blocked.json<{ error: string }>().error, /clab_admins/);
});

test("the local UI store keeps custom nodes and icons like clab-api-server", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "local-ui-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = createLocalUiStore({ clabDirectory: root, workspaceRoot: root });

  const defaults = await store.getCustomNodes();
  assert.equal(defaults.defaultNode, "SRLinux Latest");

  const saved = await store.saveCustomNode({
    name: "Leaf",
    kind: "nokia_srlinux",
    type: "ixrd2",
    setDefault: true
  });
  assert.equal(saved.defaultNode, "Leaf");
  assert.equal(saved.customNodes.find((node) => node.name === "Leaf")?.type, "ixr-d2");
  assert.equal(saved.customNodes.filter((node) => node.setDefault === true).length, 1);
  await assert.rejects(store.setDefaultCustomNode("missing"), /Custom node not found/);
  await assert.rejects(store.saveCustomNode({ name: "No kind" }), /kind is required/);

  const svg = Buffer.from("<svg/>").toString("base64");
  assert.deepEqual(await store.uploadGlobalIcon({ fileName: "My Router!.svg", dataBase64: svg }), {
    success: true,
    iconName: "my-router"
  });
  assert.equal((await store.uploadGlobalIcon({ fileName: "my router.svg", dataBase64: svg })).iconName, "my-router-1");
  await assert.rejects(store.uploadGlobalIcon({ fileName: "leaf.svg", dataBase64: svg }), /built-in/);

  await store.reconcileLabIcons("lab1", ["my-router", "leaf"]);
  assert.deepEqual(await fs.readdir(path.join(root, "lab1", ".clab-icons")), ["my-router.svg"]);
  const icons = await store.listLabIcons("lab1");
  assert.deepEqual(
    icons.icons.map((icon) => [icon.name, icon.source]),
    [
      ["my-router", "workspace"],
      ["my-router-1", "global"]
    ]
  );
  await store.reconcileLabIcons("lab1", []);
  await assert.rejects(fs.access(path.join(root, "lab1", ".clab-icons")));
  await store.deleteGlobalIcon("my-router-1");
  await assert.rejects(store.deleteGlobalIcon("my-router-1"), /Icon not found/);
});
