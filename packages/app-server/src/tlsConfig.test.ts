import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { defaultWebTlsPaths, resolveWebTlsConfig } from "./tlsConfig";

test("resolveWebTlsConfig generates and reuses a localhost certificate", (t) => {
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "containerlab-web-tls-test-"));
  t.after(() => {
    fs.rmSync(configRoot, { recursive: true, force: true });
  });

  const env = {
    ...process.env,
    XDG_CONFIG_HOME: configRoot,
    WEB_TLS_HOST: "web.example.test:3000"
  };

  const first = resolveWebTlsConfig(env);
  assert.equal(first.enabled, true);
  assert.equal(first.generated, true);
  assert.ok(first.certFile);
  assert.ok(first.keyFile);
  assert.ok(first.https?.cert);
  assert.ok(first.https?.key);

  const cert = new X509Certificate(fs.readFileSync(first.certFile));
  assert.equal(cert.checkHost("localhost"), "localhost");
  assert.equal(cert.checkHost("web.example.test"), "web.example.test");
  assert.equal(cert.checkIP("127.0.0.1"), "127.0.0.1");
  assert.equal(cert.checkIP("::1"), "::1");

  const second = resolveWebTlsConfig(env);
  assert.equal(second.enabled, true);
  assert.equal(second.generated, false);
  assert.equal(second.certFile, first.certFile);
  assert.equal(second.keyFile, first.keyFile);
});

test("resolveWebTlsConfig can be disabled", () => {
  const config = resolveWebTlsConfig({
    ...process.env,
    WEB_TLS_ENABLE: "false"
  });
  assert.deepEqual(config, { enabled: false, generated: false });
});

test("defaultWebTlsPaths uses XDG_CONFIG_HOME", () => {
  const paths = defaultWebTlsPaths({
    ...process.env,
    XDG_CONFIG_HOME: "/tmp/containerlab-web-test"
  });
  assert.equal(paths.certFile, "/tmp/containerlab-web-test/containerlab-web/tls/localhost.pem");
  assert.equal(paths.keyFile, "/tmp/containerlab-web-test/containerlab-web/tls/localhost-key.pem");
});
