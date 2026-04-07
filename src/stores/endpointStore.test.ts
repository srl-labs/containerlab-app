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
    url: "http://localhost:8080",
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
        url: "http://localhost:8080",
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
