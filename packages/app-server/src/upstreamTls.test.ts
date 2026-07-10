import assert from "node:assert/strict";
import fs from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ClabApiClient } from "./clabApiClient";
import { resolveWebTlsConfig } from "./tlsConfig";
import {
  createApiTlsTransport,
  resolveApiTlsConfig,
  resolveTrustedCaCertificates,
} from "./upstreamTls";

test("upstream TLS combines Node defaults, system trust, and an optional CA", () => {
  const source = (type: "default" | "system"): readonly string[] =>
    type === "default" ? ["bundled", "shared"] : ["system", "shared"];
  assert.deepEqual(resolveTrustedCaCertificates("custom", source), [
    "bundled",
    "shared",
    "system",
    "custom",
  ]);
});

test("upstream TLS verifies by default in production and stays local to the client", () => {
  const originalGlobalValue = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const production = resolveApiTlsConfig({}, true);
  const development = resolveApiTlsConfig({}, false);

  assert.equal(production.verify, true);
  assert.equal(development.verify, false);
  assert.ok(production.ca && production.ca.length > 0);
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, originalGlobalValue);
});

test("upstream TLS honors explicit verification overrides", () => {
  assert.equal(
    resolveApiTlsConfig({ CLAB_API_TLS_VERIFY: "false" }, true).verify,
    false,
  );
  assert.equal(
    resolveApiTlsConfig({ CLAB_API_TLS_VERIFY: "true" }, false).verify,
    true,
  );
});

test("upstream TLS loads an additional CA without replacing system roots", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clab-api-ca-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const caFile = path.join(tempDir, "ca.pem");
  fs.writeFileSync(caFile, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");

  const config = resolveApiTlsConfig(
    {
      CLAB_API_CA_FILE: caFile,
      CLAB_API_TLS_SERVER_NAME: "localhost",
      CLAB_API_TLS_VERIFY: "true",
    },
    true,
  );

  assert.equal(config.caFile, caFile);
  assert.equal(config.serverName, "localhost");
  assert.ok(config.ca && config.ca.length > 1);
  assert.equal(config.ca?.at(-1)?.includes("test"), true);
});

test("upstream TLS creates a scoped dispatcher for the merged trust policy", async () => {
  const defaultTransport = createApiTlsTransport({ verify: true });
  assert.ok(defaultTransport.dispatcher);
  assert.equal(defaultTransport.websocketOptions.rejectUnauthorized, true);
  await defaultTransport.dispose();

  const serverNameTransport = createApiTlsTransport({
    serverName: "api.example.test",
    verify: true,
  });
  assert.ok(serverNameTransport.dispatcher);
  assert.equal(
    serverNameTransport.websocketOptions.servername,
    "api.example.test",
  );
  await serverNameTransport.dispose();

  const insecureTransport = createApiTlsTransport({ verify: false });
  assert.ok(insecureTransport.dispatcher);
  assert.equal(insecureTransport.websocketOptions.rejectUnauthorized, false);
  await insecureTransport.dispose();
});

test("upstream TLS verifies the mounted local certificate with a scoped server name", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clab-api-server-name-"));
  const webTls = resolveWebTlsConfig({
    WEB_TLS_ENABLE: "true",
    WEB_TLS_HOST: "localhost",
    XDG_CONFIG_HOME: tempDir,
  });
  assert.ok(webTls.https && webTls.certFile);

  const server = https.createServer(webTls.https, (request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"status":"ok"}');
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", resolve);
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const config = resolveApiTlsConfig(
    {
      CLAB_API_CA_FILE: webTls.certFile,
      CLAB_API_TLS_SERVER_NAME: "localhost",
      CLAB_API_TLS_VERIFY: "true",
    },
    true,
  );
  const transport = createApiTlsTransport(config);
  t.after(async () => {
    await transport.dispose();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const client = new ClabApiClient({
    baseUrl: `https://127.0.0.2:${address.port}`,
    dispatcher: transport.dispatcher,
    websocketOptions: transport.websocketOptions,
  });
  await client.probeHealth();
  assert.equal(client.getWebSocketOptions().servername, "localhost");
});
