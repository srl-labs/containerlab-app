import assert from "node:assert/strict";
import test from "node:test";

import {
  EndpointPolicyError,
  createEndpointAccessPolicy,
  createEndpointAccessPolicyFromEnv,
} from "./endpointPolicy";

test("endpoint policy allows only the configured default origin by default", () => {
  const policy = createEndpointAccessPolicy({
    defaultApiUrl: "https://api.example.test:8090/base",
  });

  assert.equal(policy.isAllowed("https://api.example.test:8090/other"), true);
  assert.equal(policy.isAllowed("https://api.example.test:9443"), false);
  assert.equal(policy.isAllowed("http://api.example.test:8090"), false);
  assert.equal(policy.isAllowed("http://169.254.169.254/latest/meta-data"), false);
  assert.equal(policy.isAllowed("http://10.0.0.2:8090"), false);
  assert.equal(policy.isAllowed("https://user:pass@api.example.test:8090"), false);
  assert.throws(
    () => policy.assertAllowed("http://169.254.169.254"),
    EndpointPolicyError,
  );
});

test("endpoint policy accepts explicit exact origins including private endpoints", () => {
  const policy = createEndpointAccessPolicy({
    allowedOrigins: ["https://10.0.0.2:8090", "api.example.test:9443"],
    defaultApiUrl: "https://api.example.test:8090",
  });

  assert.equal(policy.isAllowed("https://10.0.0.2:8090"), true);
  assert.equal(policy.isAllowed("https://10.0.0.2:8091"), false);
  assert.equal(policy.isAllowed("https://api.example.test:9443"), true);
});

test("explicit local-host mode permits only local aliases with the default scheme and port", () => {
  const policy = createEndpointAccessPolicy({
    defaultApiUrl: "https://host.docker.internal:8090",
    localHostMode: true,
  });

  assert.equal(policy.isAllowed("https://localhost:8090"), true);
  assert.equal(policy.isAllowed("https://127.0.0.1:8090"), true);
  assert.equal(policy.isAllowed("https://host.containers.internal:8090"), true);
  assert.equal(policy.isAllowed("http://localhost:8090"), false);
  assert.equal(policy.isAllowed("https://localhost:2375"), false);
  assert.equal(policy.isAllowed("http://169.254.169.254:8090"), false);
  assert.equal(policy.isAllowed("https://192.168.1.10:8090"), false);
});

test("environment endpoint policy rejects invalid configured origins at startup", () => {
  assert.throws(
    () =>
      createEndpointAccessPolicyFromEnv("https://api.example.test:8090", {
        CLAB_API_ALLOWED_ORIGINS: "file:///tmp/socket",
      }),
    /Invalid clab-api-server origin/,
  );
});
