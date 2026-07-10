import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
    url: "https://localhost:8090",
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
        url: "https://localhost:8090",
        username: "alice"
      },
      {
        id: second.id,
        label: "server-b",
        sessionDuration: DEFAULT_ENDPOINT_SESSION_DURATION,
        url: "https://localhost:8090",
        username: "bob"
      }
    ]
  );

  store.dispose();
});

test("session store can persist endpoint sessions across app server restarts", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clab-endpoint-sessions-"));
  t.after(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  const persistenceFile = path.join(tempDir, "endpoint-sessions.json");
  const sessionId = "session-persisted";
  const entry = makeEntry({ label: "persisted-server" });

  const firstStore = createEndpointSessionStore({ persistenceFile });
  firstStore.upsertEndpoint(sessionId, entry);
  firstStore.dispose();

  const secondStore = createEndpointSessionStore({ persistenceFile });
  const restored = secondStore.getSession(sessionId);
  assert.ok(restored);
  assert.deepEqual(Array.from(restored.endpoints.values()), [entry]);

  const result = secondStore.removeEndpoint(sessionId, entry.id);
  assert.equal(result.sessionEmpty, true);
  secondStore.dispose();

  const thirdStore = createEndpointSessionStore({ persistenceFile });
  assert.equal(thirdStore.getSession(sessionId), null);
  thirdStore.dispose();
});

test("session store flushes throttled access timestamps before dispose without erasing sessions", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clab-endpoint-touch-"));
  t.after(() => {
    fs.rmSync(tempDir, { force: true, recursive: true });
  });

  const persistenceFile = path.join(tempDir, "endpoint-sessions.json");
  const sessionId = "session-touched";
  const store = createEndpointSessionStore({
    persistenceFile,
    touchPersistenceIntervalMs: 60_000,
  });
  store.upsertEndpoint(sessionId, makeEntry());

  const before = JSON.parse(fs.readFileSync(persistenceFile, "utf8")) as {
    sessions: Array<{ lastAccess: number; sessionId: string }>;
  };
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(store.getSession(sessionId));

  const beforeDispose = JSON.parse(fs.readFileSync(persistenceFile, "utf8")) as {
    sessions: Array<{ lastAccess: number; sessionId: string }>;
  };
  assert.equal(
    beforeDispose.sessions[0]?.lastAccess,
    before.sessions[0]?.lastAccess,
    "touch persistence should be throttled",
  );

  store.dispose();
  const afterDispose = JSON.parse(fs.readFileSync(persistenceFile, "utf8")) as {
    sessions: Array<{ lastAccess: number; sessionId: string }>;
  };
  assert.equal(afterDispose.sessions.length, 1);
  assert.equal(afterDispose.sessions[0]?.sessionId, sessionId);
  assert.ok(
    (afterDispose.sessions[0]?.lastAccess ?? 0) >
      (before.sessions[0]?.lastAccess ?? 0),
  );

  const restoredStore = createEndpointSessionStore({ persistenceFile });
  assert.ok(restoredStore.getSession(sessionId));
  restoredStore.dispose();
});
