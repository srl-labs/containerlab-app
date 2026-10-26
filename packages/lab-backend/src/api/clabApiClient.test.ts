import assert from "node:assert/strict";
import test from "node:test";
import undici, { Response } from "undici";

import { ClabApiClient, getHttpErrorStatus } from "./clabApiClient.ts";

test("getHttpErrorStatus preserves explicit upstream HTTP status", () => {
  const error = new Error("upstream returned forbidden") as Error & { status?: number };
  error.status = 403;

  assert.equal(getHttpErrorStatus(error), 403);
});

test("getHttpErrorStatus maps fetch socket failures to bad gateway", () => {
  assert.equal(getHttpErrorStatus(new TypeError("fetch failed")), 502);
});

test("getHttpErrorStatus maps wrapped clab-api-server network failures to bad gateway", () => {
  assert.equal(
    getHttpErrorStatus(
      new Error(
        "Unable to connect to clab-api-server at https://127.0.0.1:18090: fetch failed: other side closed"
      )
    ),
    502
  );
});

for (const status of [401, 403, 500]) {
  test(`file existence checks propagate ${status} instead of treating the file as missing`, async (t) => {
    t.mock.method(undici, "fetch", () => Promise.resolve(new Response(null, { status })));
    const client = new ClabApiClient({ baseUrl: "https://api.test" });
    await assert.rejects(client.headFile("token", "demo", "demo.clab.yml"), { status });
  });
}

test("file existence checks distinguish missing files from existing ones", async (t) => {
  const client = new ClabApiClient({ baseUrl: "https://api.test" });
  const mock = t.mock.method(undici, "fetch", () =>
    Promise.resolve(new Response(null, { status: 404 }))
  );
  assert.equal(await client.headFile("token", "demo", "demo.clab.yml"), false);
  mock.mock.mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })));
  assert.equal(await client.headFile("token", "demo", "demo.clab.yml"), true);
});

function captureFetchUrls(t: test.TestContext): URL[] {
  const urls: URL[] = [];
  t.mock.method(undici, "fetch", (input: unknown) => {
    urls.push(new URL(String(input)));
    return Promise.resolve(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    );
  });
  return urls;
}

test("deploy with cleanup asks the API to reconfigure the lab", async (t) => {
  const urls = captureFetchUrls(t);
  const client = new ClabApiClient({ baseUrl: "https://api.test" });

  await client.deployLab("token", "demo", { path: "demo.clab.yml", cleanup: true });

  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname, "/api/v1/labs/demo/deploy");
  assert.equal(urls[0].searchParams.get("reconfigure"), "true");
  assert.equal(urls[0].searchParams.has("cleanup"), false);
});

test("deploy without cleanup does not reconfigure a running lab", async (t) => {
  const urls = captureFetchUrls(t);
  const client = new ClabApiClient({ baseUrl: "https://api.test" });

  await client.deployLab("token", "demo", { path: "demo.clab.yml" });

  assert.equal(urls[0].searchParams.has("reconfigure"), false);
  assert.equal(urls[0].searchParams.has("cleanup"), false);
});

test("streamed deploy with cleanup sends reconfigure; destroy and redeploy keep cleanup", async (t) => {
  const urls = captureFetchUrls(t);
  const client = new ClabApiClient({ baseUrl: "https://api.test" });

  await client.openLifecycleStream("token", "deploy", "demo", { cleanup: true });
  await client.openLifecycleStream("token", "destroy", "demo", { cleanup: true });
  await client.openLifecycleStream("token", "redeploy", "demo", { cleanup: true });

  const [deploy, destroy, redeploy] = urls;
  assert.equal(deploy.pathname, "/api/v1/labs/demo/deploy");
  assert.equal(deploy.searchParams.get("reconfigure"), "true");
  assert.equal(deploy.searchParams.has("cleanup"), false);
  assert.equal(destroy.searchParams.get("cleanup"), "true");
  assert.equal(destroy.searchParams.has("reconfigure"), false);
  assert.equal(redeploy.searchParams.get("cleanup"), "true");
  assert.equal(redeploy.searchParams.has("reconfigure"), false);
});

test("redeploy and destroy with cleanup forward the cleanup flag", async (t) => {
  const urls = captureFetchUrls(t);
  const client = new ClabApiClient({ baseUrl: "https://api.test" });

  await client.redeployLab("token", "demo", { cleanup: true });
  await client.destroyLab("token", "demo", { cleanup: true });

  assert.equal(urls[0].searchParams.get("cleanup"), "true");
  assert.equal(urls[1].searchParams.get("cleanup"), "true");
});

test("lifecycle options become clab-api-server query parameters", async (t) => {
  const urls = captureFetchUrls(t);
  const client = new ClabApiClient({ baseUrl: "https://api.test" });

  await client.openLifecycleStream("token", "deploy", "demo", {
    lifecycleOptions: { nodeFilter: ["r1", "r2"], maxWorkers: 2, skipPostDeploy: true }
  });
  await client.destroyLab("token", "demo", {
    lifecycleOptions: { graceful: true, keepMgmtNet: true }
  });
  await client.redeployLab("token", "demo", {
    cleanup: true,
    lifecycleOptions: { exportTemplate: "__full", skipLabdirAcl: true }
  });

  const [deploy, destroy, redeploy] = urls;
  assert.equal(deploy.searchParams.get("nodeFilter"), "r1,r2");
  assert.equal(deploy.searchParams.get("maxWorkers"), "2");
  assert.equal(deploy.searchParams.get("skipPostDeploy"), "true");
  assert.equal(deploy.searchParams.get("stream"), "true");
  assert.equal(destroy.searchParams.get("graceful"), "true");
  assert.equal(destroy.searchParams.get("keepMgmtNet"), "true");
  assert.equal(redeploy.searchParams.get("cleanup"), "true");
  assert.equal(redeploy.searchParams.get("exportTemplate"), "__full");
  assert.equal(redeploy.searchParams.get("skipLabdirAcl"), "true");
});

test("tailscale status reads the lab's tailscale endpoint", async (t) => {
  const urls = captureFetchUrls(t);
  const client = new ClabApiClient({ baseUrl: "https://api.test" });

  await client.getLabTailscaleStatus("token", "my lab");

  assert.equal(urls.length, 1);
  assert.equal(urls[0].pathname, "/api/v1/labs/my%20lab/tailscale");
});

test("rendering asks the server for the template and its vars file", async (t) => {
  const urls: URL[] = [];
  t.mock.method(undici, "fetch", (input: unknown) => {
    urls.push(new URL(String(input)));
    return Promise.resolve(
      new Response(
        JSON.stringify({ path: "dc/dc.clab.gotmpl", content: "name: dc\n", labName: "dc", varsFiles: ["prod.yml"] }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
  });
  const client = new ClabApiClient({ baseUrl: "https://api.test" });
  assert.deepEqual(await client.renderTopology("token", "dc", "dc/dc.clab.gotmpl", "prod.yml"), {
    content: "name: dc\n",
    labName: "dc",
    varsFiles: ["prod.yml"]
  });
  assert.equal(urls[0].pathname, "/api/v1/labs/dc/topology/rendered");
  assert.equal(urls[0].searchParams.get("path"), "dc/dc.clab.gotmpl");
  assert.equal(urls[0].searchParams.get("varsPath"), "prod.yml");
});

test("a server without the render endpoint reports that it cannot render", async (t) => {
  const mock = t.mock.method(undici, "fetch", () =>
    Promise.resolve(new Response("404 page not found", { status: 404 }))
  );
  const client = new ClabApiClient({ baseUrl: "https://api.test" });
  await assert.rejects(client.renderTopology("token", "dc", "dc.clab.gotmpl"), { status: 501 });
  // A missing file on a server that renders stays a 404 with the server's message.
  mock.mock.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ error: "file not found: dc.clab.gotmpl" }), { status: 404 }))
  );
  await assert.rejects(client.renderTopology("token", "dc", "dc.clab.gotmpl"), {
    status: 404,
    message: "file not found: dc.clab.gotmpl"
  });
});

test("the vars file of a lifecycle action goes to the server as varsPath", async (t) => {
  const urls = captureFetchUrls(t);
  const client = new ClabApiClient({ baseUrl: "https://api.test" });
  await client.destroyLab("token", "demo", { lifecycleOptions: { varsFile: "vars/prod.yml" } });
  assert.equal(urls[0].searchParams.get("varsPath"), "vars/prod.yml");
});

test("a terminal session is resumable only when the client asks for it", async (t) => {
  const bodies: unknown[] = [];
  t.mock.method(undici, "fetch", (_input: unknown, init?: { body?: string }) => {
    bodies.push(JSON.parse(init?.body ?? "{}"));
    return Promise.resolve(
      new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
    );
  });
  const client = new ClabApiClient({ baseUrl: "https://api.test" });
  await client.createTerminalSession("token", "demo", "clab-demo-n1", { protocol: "shell", cols: 80, rows: 24 });
  await client.createTerminalSession("token", "demo", "clab-demo-n1", {
    protocol: "shell",
    cols: 80,
    rows: 24,
    resumable: true
  });
  assert.deepEqual(bodies, [
    { protocol: "shell", cols: 80, rows: 24 },
    { protocol: "shell", cols: 80, rows: 24, resumable: true }
  ]);
});
