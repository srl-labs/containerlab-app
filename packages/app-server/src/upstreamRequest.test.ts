import assert from "node:assert/strict";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import { apiFetch } from "./upstreamRequest.ts";
import { resolveWebTlsConfig } from "./tlsConfig.ts";
import { shouldVerifyApiTls } from "./upstreamTls.ts";

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
  assert.ok(address && typeof address !== "string");
  const url = `https://127.0.0.1:${address.port}`;
  assert.equal(shouldVerifyApiTls(), false);
  assert.equal(await (await apiFetch(url)).text(), "ok");
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, originalGlobalSetting);
  if (originalGlobalSetting !== "0") await assert.rejects(fetch(url));
  process.env.CLAB_API_TLS_VERIFY = "true";
  await assert.rejects(apiFetch(url));
});

test("ordinary API requests abort at their deadline", async (t) => {
  const hold = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(hold));
  t.mock.method(
    globalThis,
    "fetch",
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      })
  );
  await assert.rejects(apiFetch("https://api.test", {}, { timeoutMs: 10 }), {
    name: "TimeoutError"
  });
});

test("opening a stream bounds connection time but leaves its body alive", async (t) => {
  let signal: AbortSignal | null | undefined;
  t.mock.method(globalThis, "fetch", (_url: string, init: RequestInit) => {
    signal = init.signal;
    return Promise.resolve(new Response("stream"));
  });
  const caller = new AbortController();
  await apiFetch(
    "https://api.test/events",
    { signal: caller.signal },
    { stream: true, timeoutMs: 10 }
  );
  await delay(30);
  assert.equal(signal?.aborted, false);
  caller.abort();
  assert.equal(signal?.aborted, true);
});
