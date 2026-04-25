import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ENDPOINT_SESSION_DURATION,
  buildEndpointId,
  createEndpointSessionStore,
  type EndpointEntry
} from "./endpointSessionStore";

function makeEntry(overrides: Partial<EndpointEntry> = {}): EndpointEntry {
  return {
    id: buildEndpointId(),
    url: "https://localhost:8080",
    label: "server-a",
    token: "token-a",
    username: "alice",
    sessionDuration: DEFAULT_ENDPOINT_SESSION_DURATION,
    ...overrides
  };
}

test("buildEndpointId returns unique ids for repeated additions of the same URL", () => {
  const left = buildEndpointId();
  const right = buildEndpointId();

  assert.notEqual(left, right);
  assert.match(left, /^endpoint-[a-f0-9]{12}$/);
  assert.match(right, /^endpoint-[a-f0-9]{12}$/);
});

test("session store keeps distinct endpoint entries even when URLs are identical", () => {
  const store = createEndpointSessionStore();
  const sessionId = "session-1";
  const first = makeEntry({ label: "server-a" });
  const second = makeEntry({ label: "server-b", username: "bob" });

  store.upsertEndpoint(sessionId, first);
  store.upsertEndpoint(sessionId, second);

  const session = store.getSession(sessionId);
  assert.ok(session);
  assert.equal(session.endpoints.size, 2);
  assert.deepEqual(
    Array.from(session.endpoints.values()).map((entry) => ({
      id: entry.id,
      label: entry.label,
      sessionDuration: entry.sessionDuration,
      url: entry.url,
      username: entry.username
    })),
    [
      {
        id: first.id,
        label: "server-a",
        sessionDuration: DEFAULT_ENDPOINT_SESSION_DURATION,
        url: "https://localhost:8080",
        username: "alice"
      },
      {
        id: second.id,
        label: "server-b",
        sessionDuration: DEFAULT_ENDPOINT_SESSION_DURATION,
        url: "https://localhost:8080",
        username: "bob"
      }
    ]
  );

  store.dispose();
});
