import assert from "node:assert/strict";
import test from "node:test";

import {
  ENDPOINT_EXPORT_KIND,
  ENDPOINT_EXPORT_VERSION,
  EndpointTransferError,
  parseEndpointProfiles,
  serializeEndpointProfiles
} from "./endpointTransfer";

test("serializeEndpointProfiles exports only safe profile fields", () => {
  const serialized = serializeEndpointProfiles([
    {
      id: "endpoint-secret",
      url: "api.example.test/",
      label: "Primary API",
      username: "admin",
      sessionDuration: "7d",
      status: "connected",
      connected: true,
      token: "secret-token",
      password: "secret-password"
    } as never
  ]);

  assert.equal(serialized.includes("secret-token"), false);
  assert.equal(serialized.includes("secret-password"), false);
  assert.equal(serialized.includes("endpoint-secret"), false);
  assert.equal(serialized.includes("connected"), false);

  const payload = JSON.parse(serialized) as {
    endpoints: Array<Record<string, unknown>>;
    kind: string;
    version: number;
  };
  assert.equal(payload.kind, ENDPOINT_EXPORT_KIND);
  assert.equal(payload.version, ENDPOINT_EXPORT_VERSION);
  assert.deepEqual(payload.endpoints, [
    {
      url: "https://api.example.test",
      label: "Primary API",
      username: "admin",
      sessionDuration: "7d"
    }
  ]);
});

test("parseEndpointProfiles validates import document shape and normalizes URLs", () => {
  const profiles = parseEndpointProfiles(
    JSON.stringify({
      kind: ENDPOINT_EXPORT_KIND,
      version: ENDPOINT_EXPORT_VERSION,
      endpoints: [
        {
          url: "api.example.test/",
          label: "Primary API",
          username: "admin",
          sessionDuration: "24h"
        }
      ]
    })
  );

  assert.deepEqual(profiles, [
    {
      url: "https://api.example.test",
      label: "Primary API",
      username: "admin",
      sessionDuration: "24h"
    }
  ]);
});

test("parseEndpointProfiles rejects malformed files without partial results", () => {
  assert.throws(() => parseEndpointProfiles("{"), EndpointTransferError);
  assert.throws(
    () =>
      parseEndpointProfiles(
        JSON.stringify({
          kind: "other",
          version: 1,
          endpoints: []
        })
      ),
    /unsupported format/
  );
  assert.throws(
    () =>
      parseEndpointProfiles(
        JSON.stringify({
          kind: ENDPOINT_EXPORT_KIND,
          version: ENDPOINT_EXPORT_VERSION,
          endpoints: [{ url: "http://api.example.test", label: "API", username: "admin" }]
        })
      ),
    /must include url, label, username, and sessionDuration/
  );
  assert.throws(
    () =>
      parseEndpointProfiles(
        JSON.stringify({
          kind: ENDPOINT_EXPORT_KIND,
          version: ENDPOINT_EXPORT_VERSION,
          endpoints: [
            {
              url: "file:///tmp/socket",
              label: "API",
              username: "admin",
              sessionDuration: "24h"
            }
          ]
        })
      ),
    /invalid URL/
  );
  assert.throws(
    () =>
      parseEndpointProfiles(
        JSON.stringify({
          kind: ENDPOINT_EXPORT_KIND,
          version: ENDPOINT_EXPORT_VERSION,
          endpoints: [
            {
              url: "http://api.example.test",
              label: "API",
              username: "admin",
              sessionDuration: "forever"
            }
          ]
        })
      ),
    /invalid sessionDuration/
  );
});
