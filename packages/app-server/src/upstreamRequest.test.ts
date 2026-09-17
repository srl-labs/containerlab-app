import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test, { type TestContext } from "node:test";

import { apiFetch } from "./upstreamRequest.ts";
import { resolveWebTlsConfig } from "./tlsConfig.ts";
import { shouldVerifyApiTls } from "./upstreamTls.ts";

async function listen(t: TestContext, handler: http.RequestListener): Promise<string> {
  const server = http.createServer(handler);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

test("self-signed API certificates work by default without weakening other HTTPS requests", async (t) => {
  const originalSetting = process.env.CLAB_API_TLS_VERIFY;
  const originalGlobalSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  delete process.env.CLAB_API_TLS_VERIFY;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "app-api-tls-"));
  const config = resolveWebTlsConfig({
    XDG_CONFIG_HOME: directory,
    WEB_TLS_HOST: "localhost"
  });
  assert.ok(config.https);
  const server = https.createServer(config.https, (_request, response) => {
    response.end("ok");
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    fs.rmSync(directory, { recursive: true, force: true });
    if (originalSetting === undefined) delete process.env.CLAB_API_TLS_VERIFY;
    else process.env.CLAB_API_TLS_VERIFY = originalSetting;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const url = `https://127.0.0.1:${address.port}`;
  assert.equal(shouldVerifyApiTls(), false);
  assert.equal(await (await apiFetch(url)).text(), "ok");
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, originalGlobalSetting);
  if (originalGlobalSetting !== "0") await assert.rejects(fetch(url));
  process.env.CLAB_API_TLS_VERIFY = "true";
  await assert.rejects(apiFetch(url), (error: unknown) => {
    assert.ok(error instanceof TypeError && error.cause instanceof Error && "code" in error.cause);
    assert.equal(error.cause.code, "DEPTH_ZERO_SELF_SIGNED_CERT");
    return true;
  });
});

test("both TLS modes preserve request bodies and reject redirects", async (t) => {
  const originalSetting = process.env.CLAB_API_TLS_VERIFY;
  t.after(() => {
    if (originalSetting === undefined) delete process.env.CLAB_API_TLS_VERIFY;
    else process.env.CLAB_API_TLS_VERIFY = originalSetting;
  });
  let redirectedRequests = 0;
  const url = await listen(t, (request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/target" }).end();
      return;
    }
    if (request.url === "/target") redirectedRequests++;
    response.setHeader("x-request-method", request.method ?? "");
    response.setHeader("x-request-authorization", request.headers.authorization ?? "");
    request.pipe(response);
  });
  for (const verify of ["false", "true"]) {
    process.env.CLAB_API_TLS_VERIFY = verify;
    const response = await apiFetch(url, {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      body: "request body"
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-request-method"), "POST");
    assert.equal(response.headers.get("x-request-authorization"), "Bearer test-token");
    assert.equal(await response.text(), "request body");
    await assert.rejects(apiFetch(`${url}/redirect`), { name: "TypeError" });
  }
  assert.equal(redirectedRequests, 0);
});

test("ordinary API requests abort at their deadline", async (t) => {
  const url = await listen(t, () => {});
  await assert.rejects(apiFetch(url, {}, { timeoutMs: 50 }), {
    name: "TimeoutError"
  });
});

test("opening a stream bounds connection time but leaves its body alive", async (t) => {
  const url = await listen(t, (request, response) => {
    if (request.url === "/pending") return;
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write("data: ready\n\n");
  });
  await assert.rejects(apiFetch(`${url}/pending`, {}, { stream: true, timeoutMs: 50 }), {
    name: "TimeoutError"
  });
  const caller = new AbortController();
  const response = await apiFetch(
    `${url}/events`,
    { signal: caller.signal },
    { stream: true, timeoutMs: 250 }
  );
  const reader = response.body?.getReader();
  assert.ok(reader);
  await delay(300);
  const chunk = await reader.read();
  assert.equal(chunk.done, false);
  assert.equal(new TextDecoder().decode(chunk.value), "data: ready\n\n");
  caller.abort();
  await assert.rejects(reader.read(), { name: "AbortError" });
});
