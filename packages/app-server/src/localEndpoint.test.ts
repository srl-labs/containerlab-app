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

async function createApp(
  t: TestContext,
  status: LocalEndpointStatus | null,
  extra: { autoConnect?: boolean; sessionPersistenceFile?: string } = {}
) {
  const calls: string[] = [];
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-endpoint-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const app = await createStandaloneApp({
    isDev: true,
    logger: false,
    viteDevUrl: "http://vite.test",
    ...(extra.sessionPersistenceFile ? { sessionPersistenceFile: extra.sessionPersistenceFile } : {}),
    ...(status
      ? {
          localEndpoint: {
            backend: fakeLocalBackend(calls),
            ui: createLocalUiStore({ clabDirectory: workspaceRoot, workspaceRoot }),
            status: async () => status,
            autoConnect: extra.autoConnect
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

test("an app that runs labs locally by default connects new sessions to its machine", async (t) => {
  const { app } = await createApp(t, AVAILABLE, { autoConnect: true });
  const first = await app.inject("/api/config");
  const config = first.json<{ endpoints: Array<{ id: string; kind: string; label: string }> }>();
  assert.deepEqual(
    config.endpoints.map((entry) => [entry.kind, entry.label]),
    [["local", "This computer"]]
  );
  const cookie = sessionCookie(first.headers["set-cookie"]);
  assert.ok(cookie, "the first request starts a session");

  // Later requests reuse the endpoint instead of adding another.
  const me = (await app.inject({ url: "/auth/me", headers: { cookie } })).json<{
    authenticated: boolean;
    endpoints: Array<{ id: string; status: string }>;
  }>();
  assert.equal(me.authenticated, true);
  assert.deepEqual(
    me.endpoints.map((entry) => entry.id),
    [config.endpoints[0].id]
  );
});

test("a removed local endpoint stays removed until the user adds it again", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-sessions-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const sessionPersistenceFile = path.join(directory, "sessions.json");
  const { app } = await createApp(t, AVAILABLE, { autoConnect: true, sessionPersistenceFile });
  const first = await app.inject("/auth/endpoints");
  const cookie = sessionCookie(first.headers["set-cookie"]);
  const [local] = first.json<{ endpoints: Array<{ id: string }> }>().endpoints;

  const removed = await app.inject({ method: "DELETE", url: `/auth/endpoints/${local.id}`, headers: { cookie } });
  assert.equal(removed.statusCode, 200);
  assert.doesNotMatch(String(removed.headers["set-cookie"]), /clab_session=;/, "the session keeps its cookie");
  const listed = await app.inject({ url: "/auth/endpoints", headers: { cookie } });
  assert.deepEqual(listed.json<{ endpoints: unknown[] }>().endpoints, []);

  // The choice survives a restart of the app.
  const restarted = await createApp(t, AVAILABLE, { autoConnect: true, sessionPersistenceFile });
  const afterRestart = await restarted.app.inject({ url: "/api/config", headers: { cookie } });
  assert.deepEqual(afterRestart.json<{ endpoints: unknown[] }>().endpoints, []);

  const added = await restarted.app.inject({
    method: "POST",
    url: "/auth/endpoints/add",
    headers: { cookie },
    payload: { kind: "local" }
  });
  assert.equal(added.statusCode, 200);
  await restarted.app.inject({ method: "DELETE", url: `/auth/endpoints/${added.json<{ id: string }>().id}`, headers: { cookie } });
  await restarted.app.inject({ method: "POST", url: "/auth/endpoints/add", headers: { cookie }, payload: { kind: "local" } });
  const again = await restarted.app.inject({ url: "/auth/endpoints", headers: { cookie } });
  assert.equal(again.json<{ endpoints: unknown[] }>().endpoints.length, 1);
});

test("sessions are not connected to a machine where containerlab cannot run", async (t) => {
  const { app } = await createApp(
    t,
    { ...AVAILABLE, available: false, problems: ["containerlab is not installed."] },
    { autoConnect: true }
  );
  const config = (await app.inject("/api/config")).json<{
    endpoints: unknown[];
    localEndpoint: LocalEndpointStatus;
  }>();
  assert.deepEqual(config.endpoints, []);
  assert.deepEqual(config.localEndpoint.problems, ["containerlab is not installed."]);
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

test("several local lab hosts live side by side, each with its own backend", async (t) => {
  const dockerCalls: string[] = [];
  const clusterCalls: string[] = [];
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-hosts-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const ui = createLocalUiStore({ clabDirectory: workspaceRoot, workspaceRoot });
  const cluster: LocalEndpointStatus = {
    ...AVAILABLE,
    label: "Cluster kind-c9s-app (c9s)",
    runtime: "c9s",
    kubeContext: "kind-c9s-app"
  };
  const clusterBackend = {
    ...fakeLocalBackend(clusterCalls),
    async hostProfile() {
      return { runtime: "c9s", kubeContext: "kind-c9s-app", namespaceMode: "per-lab" };
    }
  } as unknown as LabBackend;
  const app = await createStandaloneApp({
    isDev: true,
    logger: false,
    viteDevUrl: "http://vite.test",
    localEndpoints: [
      { backend: fakeLocalBackend(dockerCalls), ui, status: async () => AVAILABLE, autoConnect: true },
      { url: "local://c9s/kind-c9s-app", backend: clusterBackend, ui, status: async () => cluster, autoConnect: true }
    ]
  });
  t.after(() => app.close());

  const first = await app.inject("/api/config");
  const cookie = sessionCookie(first.headers["set-cookie"]);
  const config = first.json<{
    endpoints: Array<{ id: string; url: string; label: string }>;
    localEndpoint: LocalEndpointStatus;
    localEndpoints: LocalEndpointStatus[];
  }>();
  assert.deepEqual(
    config.endpoints.map((entry) => [entry.url, entry.label]),
    [
      ["local://this-computer", "This computer"],
      ["local://c9s/kind-c9s-app", "Cluster kind-c9s-app (c9s)"]
    ]
  );
  assert.deepEqual(config.localEndpoint, AVAILABLE);
  assert.deepEqual(
    config.localEndpoints.map((status) => [status.url, status.runtime]),
    [
      ["local://this-computer", undefined],
      ["local://c9s/kind-c9s-app", "c9s"]
    ]
  );

  const clusterId = config.endpoints[1].id;
  await app.inject({ url: "/api/runtime/inspect/all", headers: { cookie, "x-endpoint-id": clusterId } });
  assert.ok(clusterCalls.includes("inspectAll"));
  assert.ok(!dockerCalls.includes("inspectAll"));

  const listed = (await app.inject({ url: "/auth/endpoints", headers: { cookie } })).json<{
    endpoints: Array<{ id: string; runtime?: string; kubeContext?: string }>;
  }>();
  assert.deepEqual(
    listed.endpoints.find((entry) => entry.id === clusterId),
    {
      id: clusterId,
      kind: "local",
      url: "local://c9s/kind-c9s-app",
      label: "Cluster kind-c9s-app (c9s)",
      username: "alice",
      sessionDuration: "24h",
      status: "connected",
      connected: true,
      runtime: "c9s",
      kubeContext: "kind-c9s-app"
    }
  );

  // Removing the cluster leaves this computer, and the cluster stays removed.
  await app.inject({ method: "DELETE", url: `/auth/endpoints/${clusterId}`, headers: { cookie } });
  const after = (await app.inject({ url: "/api/config", headers: { cookie } })).json<{
    endpoints: Array<{ url: string }>;
  }>();
  assert.deepEqual(after.endpoints.map((entry) => entry.url), ["local://this-computer"]);

  const readded = await app.inject({
    method: "POST",
    url: "/auth/endpoints/add",
    headers: { cookie },
    payload: { kind: "local", url: "local://c9s/kind-c9s-app" }
  });
  assert.equal(readded.statusCode, 200, readded.body);
  const unknown = await app.inject({
    method: "POST",
    url: "/auth/endpoints/add",
    headers: { cookie },
    payload: { kind: "local", url: "local://c9s/other" }
  });
  assert.equal(unknown.statusCode, 400);
});

test("an app whose only local host is a cluster lists it as Kubernetes, and offers it again once removed", async (t) => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-cluster-only-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const ui = createLocalUiStore({ clabDirectory: workspaceRoot, workspaceRoot });
  const url = "local://c9s/kind-c9s-app?kubeconfig=%2Fhome%2Falice%2Fapp.kubeconfig";
  const cluster: LocalEndpointStatus = { ...AVAILABLE, label: "kind-c9s-app", runtime: "c9s", kubeContext: "kind-c9s-app" };
  const app = await createStandaloneApp({
    isDev: true,
    logger: false,
    viteDevUrl: "http://vite.test",
    localUnavailable: "The web app runs labs on its own server only with Docker or Podman.",
    localEndpoints: [{ url, backend: fakeLocalBackend([]), ui, status: async () => cluster, autoConnect: true }]
  });
  t.after(() => app.close());

  const first = await app.inject("/api/config");
  const cookie = sessionCookie(first.headers["set-cookie"]);
  const config = first.json<{
    endpoints: Array<{ id: string; kind: string; url: string; runtime?: string }>;
    localEndpoints: LocalEndpointStatus[];
    localUnavailable?: string;
  }>();
  // The runtime comes with the list, so the app never shows the cluster as "This computer · Docker".
  assert.deepEqual(
    config.endpoints.map((entry) => [entry.kind, entry.url, entry.runtime]),
    [["local", url, "c9s"]]
  );
  assert.ok(config.localUnavailable, "This computer is not offered");

  await app.inject({ method: "DELETE", url: `/auth/endpoints/${config.endpoints[0].id}`, headers: { cookie } });
  const removed = (await app.inject({ url: "/api/config", headers: { cookie } })).json<{
    endpoints: unknown[];
    localEndpoints: LocalEndpointStatus[];
  }>();
  assert.deepEqual(removed.endpoints, []);
  // Still offered, under Kubernetes, to add again.
  assert.deepEqual(
    removed.localEndpoints.map((status) => [status.url, status.runtime]),
    [[url, "c9s"]]
  );
  const readded = await app.inject({
    method: "POST",
    url: "/auth/endpoints/add",
    headers: { cookie },
    payload: { kind: "local", url }
  });
  assert.equal(readded.statusCode, 200, readded.body);
  assert.equal(readded.json<{ runtime?: string }>().runtime, "c9s");
});
