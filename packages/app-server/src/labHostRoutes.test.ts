import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import type { ClusterHostSettings, LocalEndpointStatus } from "@srl-labs/containerlab-app-contract";
import type { LabBackend } from "@srl-labs/containerlab-lab-backend";

import { createStandaloneApp, type LocalEndpointOptions } from "./app";
import { localEndpointUrl, clusterBackendOptions, writeLocalBackendClusters } from "./localEndpointConfig";
import { createLocalUiStore } from "./localUiStore";

const FAILED_CHECKS = [
  { id: "cluster", label: "The cluster answers", status: "failed" as const, message: "connect ECONNREFUSED" }
];

function fakeBackend(disposed: string[], url: string): LabBackend {
  return {
    kind: "local",
    scope: url,
    async version() {
      return { versionInfo: "version: 0.83.0" };
    },
    async dispose() {
      disposed.push(url);
    }
  } as unknown as LabBackend;
}

async function createApp(t: TestContext, withClusterHosts: boolean) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lab-host-routes-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const saved: ClusterHostSettings[][] = [];
  const disposed: string[] = [];
  const ui = createLocalUiStore({ clabDirectory: workspaceRoot, workspaceRoot });
  const clusterEndpoint = (settings: ClusterHostSettings): LocalEndpointOptions & { url: string } => {
    const url = localEndpointUrl(clusterBackendOptions(settings));
    // The cluster "down" does not answer.
    const status: LocalEndpointStatus = {
      available: settings.kubeContext !== "down",
      problems: settings.kubeContext === "down" ? ["The cluster does not answer"] : [],
      label: settings.label ?? settings.kubeContext,
      username: "alice",
      runtime: "c9s",
      kubeContext: settings.kubeContext,
      editable: true,
      ...(settings.kubeContext === "down" ? { checks: FAILED_CHECKS } : { checks: [] })
    };
    return { url, backend: fakeBackend(disposed, url), ui, autoConnect: true, cluster: settings, status: async () => status };
  };
  const app = await createStandaloneApp({
    isDev: true,
    logger: false,
    viteDevUrl: "http://vite.test",
    localEndpoints: [
      {
        url: "local://this-computer",
        backend: fakeBackend(disposed, "local://this-computer"),
        ui,
        autoConnect: true,
        status: async () => ({ available: true, problems: [], checks: [], label: "This computer", username: "alice" })
      }
    ],
    ...(withClusterHosts
      ? {
          clusterHosts: {
            create: clusterEndpoint,
            save: async (clusters) => {
              saved.push(clusters);
            },
            defaultKubeconfig: "/home/alice/.kube/config"
          }
        }
      : { clustersUnavailable: "Only the server's configuration adds clusters." })
  });
  t.after(() => app.close());
  return { app, saved, disposed };
}

test("the desktop app adds, edits and removes clusters; a failing one is listed with its checks", async (t) => {
  const { app, saved, disposed } = await createApp(t, true);
  const config = (await app.inject("/api/config")).json<{ clusterHosts?: { defaultKubeconfig?: string } }>();
  assert.deepEqual(config.clusterHosts, { defaultKubeconfig: "/home/alice/.kube/config" });
  const cookie = (await app.inject("/auth/endpoints")).headers["set-cookie"];
  const headers = { cookie: (Array.isArray(cookie) ? cookie[0] : (cookie ?? "")).split(";")[0] };

  const added = await app.inject({
    method: "POST",
    url: "/api/lab-hosts/clusters",
    headers,
    payload: { settings: { kubeContext: "down", label: "Lab cluster", exposeType: "None" } }
  });
  assert.equal(added.statusCode, 200);
  const url = added.json<{ url: string }>().url;
  assert.equal(url, "local://c9s/down");
  assert.deepEqual(saved.at(-1), [{ kubeContext: "down", label: "Lab cluster", exposeType: "None" }]);

  // Listed although it cannot run labs, with the failed check.
  const listed = (await app.inject({ url: "/auth/endpoints", headers })).json<{
    endpoints: Array<{ url: string; status: string; checks?: unknown[]; editable?: boolean }>;
  }>().endpoints;
  const cluster = listed.find((endpoint) => endpoint.url === url);
  assert.equal(cluster?.status, "offline");
  assert.equal(cluster?.editable, true);
  assert.deepEqual(cluster?.checks, FAILED_CHECKS);

  const check = await app.inject({ method: "POST", url: "/api/lab-hosts/check", headers, payload: { url } });
  assert.deepEqual(check.json(), { available: false, checks: FAILED_CHECKS });

  const edited = await app.inject({
    method: "POST",
    url: "/api/lab-hosts/clusters",
    headers,
    payload: { url, settings: { kubeContext: "kind-c9s-app", namespace: "team-a" } }
  });
  assert.equal(edited.json<{ url: string }>().url, "local://c9s/kind-c9s-app");
  assert.deepEqual(saved.at(-1), [{ kubeContext: "kind-c9s-app", namespace: "team-a" }]);
  assert.deepEqual(disposed, [url]);

  const invalid = await app.inject({ method: "POST", url: "/api/lab-hosts/clusters", headers, payload: { settings: { namespace: "x" } } });
  assert.equal(invalid.statusCode, 400);

  const removed = await app.inject({ method: "DELETE", url: "/api/lab-hosts/clusters?url=local%3A%2F%2Fc9s%2Fkind-c9s-app", headers });
  assert.equal(removed.statusCode, 200);
  assert.deepEqual(saved.at(-1), []);
  // This computer is not a cluster the app manages.
  const notManaged = await app.inject({ method: "DELETE", url: "/api/lab-hosts/clusters?url=local%3A%2F%2Fthis-computer", headers });
  assert.equal(notManaged.statusCode, 404);
});

test("the web app has no cluster routes and says why", async (t) => {
  const { app } = await createApp(t, false);
  const config = (await app.inject("/api/config")).json<{ clusterHosts?: unknown; clustersUnavailable?: string }>();
  assert.equal(config.clusterHosts, undefined);
  assert.equal(config.clustersUnavailable, "Only the server's configuration adds clusters.");
  for (const [method, url] of [
    ["GET", "/api/lab-hosts/kubeconfig/contexts"],
    ["POST", "/api/lab-hosts/clusters"],
    ["POST", "/api/lab-hosts/clusters/check"],
    ["DELETE", "/api/lab-hosts/clusters?url=x"]
  ] as const) {
    const response = await app.inject({ method, url, payload: method === "GET" || method === "DELETE" ? undefined : {} });
    assert.notEqual(response.statusCode, 200, `${method} ${url}`);
  }
});

test("the settings file keeps everything but the clusters it is given", () => {
  const written = writeLocalBackendClusters(
    JSON.stringify({ binaryPath: "/opt/containerlab", clusters: [{ kubeContext: "old" }] }),
    [{ kubeContext: "kind-c9s-app", kubeconfig: "~/.kube/kind.yaml" }]
  );
  assert.deepEqual(JSON.parse(written), {
    binaryPath: "/opt/containerlab",
    clusters: [{ kubeContext: "kind-c9s-app", kubeconfig: "~/.kube/kind.yaml" }]
  });
  assert.deepEqual(JSON.parse(writeLocalBackendClusters(undefined, [])), { clusters: [] });
});
