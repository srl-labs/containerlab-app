import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  startStandaloneServer,
  type StandaloneServerHandle
} from "./index.js";

let serverHandle: StandaloneServerHandle | null = null;
let tempDir: string | null = null;

afterEach(async () => {
  if (serverHandle) {
    await serverHandle.close();
    serverHandle = null;
  }

  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

test("starts on dynamic loopback port and serves API config", async () => {
  serverHandle = await startStandaloneServer({
    host: "127.0.0.1",
    logger: false,
    port: 0,
    nodeEnv: "development",
    logStartup: false
  });

  assert.ok(serverHandle.port > 0);
  assert.equal(serverHandle.host, "127.0.0.1");

  const response = await fetch(`${serverHandle.origin}/api/config`);
  assert.equal(response.status, 200);

  const payload = (await response.json()) as {
    defaultClabApiUrl?: string;
    endpoints?: unknown[];
  };

  assert.equal(payload.defaultClabApiUrl, "http://localhost:8080");
  assert.deepEqual(payload.endpoints, []);
});

test("serves static assets from an explicit production client root", async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "clab-web-static-"));
  await writeFile(path.join(tempDir, "index.html"), "<html><body>desktop</body></html>");

  serverHandle = await startStandaloneServer({
    host: "127.0.0.1",
    logger: false,
    port: 0,
    nodeEnv: "production",
    clientRoot: tempDir,
    logStartup: false
  });

  const response = await fetch(serverHandle.origin);
  assert.equal(response.status, 200);

  const body = await response.text();
  assert.match(body, /desktop/);
});
