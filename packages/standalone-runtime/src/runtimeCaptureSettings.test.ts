import assert from "node:assert/strict";
import test from "node:test";

import {
  getSessionHostnameOverride,
  loadCapturePreferences,
  normalizeCapturePreferences,
  persistCapturePreferences,
  setSessionHostnameOverride
} from "./runtimeCaptureSettings";

const CAPTURE_SETTINGS_STORAGE_KEY = "clab-standalone-capture-settings";

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

function resetSessionHostnameOverrides(): void {
  setSessionHostnameOverride(undefined);
  setSessionHostnameOverride(undefined, "endpoint-a");
  setSessionHostnameOverride(undefined, "endpoint-b");
  setSessionHostnameOverride(undefined, "endpoint-x");
}

test.beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
    writable: true
  });
  resetSessionHostnameOverrides();
});

test.after(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: originalLocalStorage,
    configurable: true,
    writable: true
  });
  resetSessionHostnameOverrides();
});

test("normalizeCapturePreferences falls back to default action for invalid input", () => {
  const normalized = normalizeCapturePreferences({ preferredAction: "invalid" });
  assert.equal(normalized.preferredAction, "wireshark-vnc");
});

test("capture preferences are persisted and resolved per endpoint", () => {
  persistCapturePreferences({ preferredAction: "edgeshark" });
  persistCapturePreferences({ preferredAction: "wireshark-vnc" }, " endpoint-a ");

  assert.equal(loadCapturePreferences().preferredAction, "edgeshark");
  assert.equal(loadCapturePreferences("endpoint-a").preferredAction, "wireshark-vnc");
  assert.equal(loadCapturePreferences("endpoint-b").preferredAction, "edgeshark");

  const raw = globalThis.localStorage.getItem(CAPTURE_SETTINGS_STORAGE_KEY);
  assert.ok(raw);
  const persisted = JSON.parse(raw) as {
    defaultPreferences?: { preferredAction?: string };
    preferencesByEndpoint?: Record<string, { preferredAction?: string }>;
  };

  assert.equal(persisted.defaultPreferences?.preferredAction, "edgeshark");
  assert.equal(persisted.preferencesByEndpoint?.["endpoint-a"]?.preferredAction, "wireshark-vnc");
});

test("loadCapturePreferences supports legacy flat storage payload", () => {
  globalThis.localStorage.setItem(
    CAPTURE_SETTINGS_STORAGE_KEY,
    JSON.stringify({ preferredAction: "edgeshark" })
  );

  assert.equal(loadCapturePreferences().preferredAction, "edgeshark");
  assert.equal(loadCapturePreferences("endpoint-x").preferredAction, "edgeshark");
});

test("session hostname override is scoped per endpoint with default fallback", () => {
  setSessionHostnameOverride("shared-host");
  setSessionHostnameOverride("endpoint-a-host", "endpoint-a");

  assert.equal(getSessionHostnameOverride(), "shared-host");
  assert.equal(getSessionHostnameOverride("endpoint-a"), "endpoint-a-host");
  assert.equal(getSessionHostnameOverride("endpoint-b"), "shared-host");

  setSessionHostnameOverride(undefined, "endpoint-a");
  assert.equal(getSessionHostnameOverride("endpoint-a"), "shared-host");

  setSessionHostnameOverride(undefined);
  assert.equal(getSessionHostnameOverride("endpoint-a"), undefined);
  assert.equal(getSessionHostnameOverride("endpoint-b"), undefined);
});
