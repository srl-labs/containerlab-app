import assert from "node:assert/strict";
import test from "node:test";

import {
  STANDALONE_FAVORITES_STORAGE_KEY,
  buildFavoriteKey,
  isStandaloneFavorite,
  loadFavoriteKeys,
  toggleStandaloneFavorite,
  type StorageLike
} from "./standaloneFavorites";
import { buildStandaloneTopologyRefFromPath } from "./standaloneHostShared";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("buildFavoriteKey scopes favorites by endpoint and normalized path", () => {
  const topologyRef = buildStandaloneTopologyRefFromPath(
    "\\labs//Demo.clab.yml",
    "demo",
    "endpoint-a"
  );

  assert.equal(
    buildFavoriteKey({ topologyRef }),
    "endpoint-a:/labs/demo.clab.yml"
  );
  assert.equal(
    buildFavoriteKey({ endpointId: "endpoint-b", topologyRef }),
    "endpoint-b:/labs/demo.clab.yml"
  );
});

test("toggleStandaloneFavorite persists and removes favorite keys", () => {
  const storage = new MemoryStorage();
  const topologyRef = buildStandaloneTopologyRefFromPath("labs/demo.clab.yml", "demo", "ep-1");
  const target = { topologyRef };

  assert.equal(isStandaloneFavorite(target, storage), false);
  assert.equal(toggleStandaloneFavorite(target, storage), true);
  assert.equal(isStandaloneFavorite(target, storage), true);
  assert.deepEqual([...loadFavoriteKeys(storage)], ["ep-1:labs/demo.clab.yml"]);

  assert.equal(toggleStandaloneFavorite(target, storage), false);
  assert.equal(isStandaloneFavorite(target, storage), false);
  assert.deepEqual([...loadFavoriteKeys(storage)], []);
});

test("loadFavoriteKeys ignores malformed persisted data", () => {
  const storage = new MemoryStorage();
  storage.setItem(STANDALONE_FAVORITES_STORAGE_KEY, "{");

  assert.deepEqual([...loadFavoriteKeys(storage)], []);
});
