import assert from "node:assert/strict";
import test from "node:test";

import { connectedEndpoints, isConnectedEndpointId } from "./standaloneEndpointSelection";
import type { EndpointConfig, EndpointStatus } from "./stores/endpointStore";

function buildEndpoint(id: string, status: EndpointStatus): EndpointConfig {
  return {
    id,
    url: `http://localhost/${id}`,
    label: id,
    username: "user",
    sessionDuration: "24h",
    status,
    connected: status === "connected"
  };
}

test("connectedEndpoints keeps only endpoints with active sessions", () => {
  const endpoints = [
    buildEndpoint("connected-a", "connected"),
    buildEndpoint("saved-a", "saved"),
    buildEndpoint("expired-a", "session_expired"),
    buildEndpoint("offline-a", "offline")
  ];

  assert.deepEqual(
    connectedEndpoints(endpoints).map((endpoint) => endpoint.id),
    ["connected-a"]
  );
});

test("isConnectedEndpointId rejects saved, expired, offline, and unknown endpoints", () => {
  const endpoints = [
    buildEndpoint("connected-a", "connected"),
    buildEndpoint("saved-a", "saved"),
    buildEndpoint("expired-a", "session_expired"),
    buildEndpoint("offline-a", "offline")
  ];

  assert.equal(isConnectedEndpointId(endpoints, "connected-a"), true);
  assert.equal(isConnectedEndpointId(endpoints, "saved-a"), false);
  assert.equal(isConnectedEndpointId(endpoints, "expired-a"), false);
  assert.equal(isConnectedEndpointId(endpoints, "offline-a"), false);
  assert.equal(isConnectedEndpointId(endpoints, "missing-a"), false);
});
