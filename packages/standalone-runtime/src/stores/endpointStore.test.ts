import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ENDPOINT_SESSION_DURATION,
  isValidEndpointSessionDuration,
  useEndpointStore
} from "./endpointStore";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const originalLocalStorage = globalThis.localStorage;

test.beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true
  });
  useEndpointStore.setState({ endpoints: new Map() });
});

test.after(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: originalLocalStorage,
    configurable: true,
    writable: true
  });
});

test("setSessionDuration updates the endpoint and persists it", () => {
  const store = useEndpointStore.getState();
  store.addEndpoint({
    id: "endpoint-1",
    url: "https://localhost:8090",
    label: "server-a",
    username: "alice",
    sessionDuration: DEFAULT_ENDPOINT_SESSION_DURATION,
    status: "saved",
    connected: false
  });

  store.setSessionDuration("endpoint-1", "7d");

  const endpoint = useEndpointStore.getState().endpoints.get("endpoint-1");
  assert.equal(endpoint?.sessionDuration, "7d");

  const persisted = JSON.parse(
    globalThis.localStorage.getItem("clab-standalone-endpoints") ?? "[]"
  ) as Array<{ sessionDuration?: string }>;
  assert.equal(persisted[0]?.sessionDuration, "7d");
});

test("hydratePersisted defaults missing sessionDuration to 24h", () => {
  globalThis.localStorage.setItem(
    "clab-standalone-endpoints",
    JSON.stringify([
      {
        id: "endpoint-1",
        url: "https://localhost:8090",
        label: "server-a",
        username: "alice"
      }
    ])
  );

  useEndpointStore.getState().hydratePersisted();

  const endpoint = useEndpointStore.getState().endpoints.get("endpoint-1");
  assert.ok(endpoint);
  assert.equal(endpoint.sessionDuration, DEFAULT_ENDPOINT_SESSION_DURATION);
  assert.equal(endpoint.status, "saved");
  assert.equal(endpoint.connected, false);
});

test("importProfiles merges by URL and username while preserving connection state", () => {
  const store = useEndpointStore.getState();
  store.addEndpoint({
    id: "endpoint-connected",
    url: "https://api.example.test",
    label: "Old API",
    username: "admin",
    sessionDuration: "24h",
    status: "connected",
    connected: true
  });
  store.addEndpoint({
    id: "endpoint-other",
    url: "http://other.example.test",
    label: "Other API",
    username: "admin",
    sessionDuration: "24h",
    status: "saved",
    connected: false
  });

  const result = store.importProfiles([
    {
      url: "api.example.test/",
      label: "Updated API",
      username: "admin",
      sessionDuration: "7d"
    },
    {
      url: "new.example.test",
      label: "New API",
      username: "operator",
      sessionDuration: "24h"
    },
    {
      url: "https://new.example.test/",
      label: "New API Renamed",
      username: "operator",
      sessionDuration: "36h"
    }
  ]);

  assert.deepEqual(result, {
    added: 1,
    duplicates: 1,
    total: 3,
    unchanged: 0,
    updated: 1
  });

  const endpoints = useEndpointStore.getState().endpoints;
  const connected = endpoints.get("endpoint-connected");
  assert.equal(connected?.label, "Updated API");
  assert.equal(connected?.sessionDuration, "7d");
  assert.equal(connected?.status, "connected");
  assert.equal(connected?.connected, true);

  const imported = Array.from(endpoints.values()).find(
    (endpoint) => endpoint.url === "https://new.example.test"
  );
  assert.ok(imported);
  assert.equal(imported.label, "New API Renamed");
  assert.equal(imported.username, "operator");
  assert.equal(imported.sessionDuration, "36h");
  assert.equal(imported.status, "saved");
  assert.equal(imported.connected, false);

  const persisted = JSON.parse(
    globalThis.localStorage.getItem("clab-standalone-endpoints") ?? "[]"
  ) as Array<{ connected?: boolean; id?: string; label?: string; status?: string; token?: string }>;
  assert.equal(persisted.some((endpoint) => endpoint.label === "New API Renamed"), true);
  assert.equal(persisted.some((endpoint) => endpoint.status !== undefined), false);
  assert.equal(persisted.some((endpoint) => endpoint.connected !== undefined), false);
  assert.equal(persisted.some((endpoint) => endpoint.token !== undefined), false);
});

test("isValidEndpointSessionDuration accepts free-form durations", () => {
  assert.equal(isValidEndpointSessionDuration("24h"), true);
  assert.equal(isValidEndpointSessionDuration("36h"), true);
  assert.equal(isValidEndpointSessionDuration("1h30m"), true);
  assert.equal(isValidEndpointSessionDuration("7d"), true);
  assert.equal(isValidEndpointSessionDuration("1.5d"), true);
  assert.equal(isValidEndpointSessionDuration("2w"), true);
  assert.equal(isValidEndpointSessionDuration("forever"), false);
  assert.equal(isValidEndpointSessionDuration(""), false);
});
