import assert from "node:assert/strict";
import test from "node:test";

import { mergeStoredAndServerEndpoints } from "./endpointMerge";
import type { EndpointConfig } from "./stores/endpointStore";

function endpoint(input: Partial<EndpointConfig> & Pick<EndpointConfig, "id" | "url">): EndpointConfig {
  return {
    label: input.id,
    username: "alice",
    sessionDuration: "24h",
    status: "connected",
    connected: true,
    ...input
  };
}

test("a local host the server no longer lists does not linger as a signed-out entry", () => {
  // An earlier session's cluster, kept in the browser without its runtime.
  const stale = endpoint({ id: "endpoint-old", kind: "local", url: "local://c9s/kind-c9s-app", status: "saved", connected: false });
  const server = endpoint({ id: "endpoint-new", kind: "local", url: "local://c9s/kind-c9s-app", runtime: "c9s" });
  const api = endpoint({ id: "endpoint-api", kind: "api", url: "https://lab:8090" });
  const merged = mergeStoredAndServerEndpoints(
    new Map([
      [stale.id, stale],
      [api.id, api]
    ]),
    [server]
  );
  assert.deepEqual(
    merged.map((entry) => [entry.id, entry.status]),
    [
      ["endpoint-api", "saved"],
      ["endpoint-new", "connected"]
    ]
  );
});

test("with nothing listed, API Servers stay to sign in again and local hosts go", () => {
  const local = endpoint({ id: "local", kind: "local", url: "local://this-computer" });
  const api = endpoint({ id: "api", kind: "api", url: "https://lab:8090", sessionDuration: "8h" });
  const merged = mergeStoredAndServerEndpoints(
    new Map([
      [local.id, local],
      [api.id, api]
    ]),
    []
  );
  assert.deepEqual(merged, [{ ...api, status: "saved", connected: false }]);
});
