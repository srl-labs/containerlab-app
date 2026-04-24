import type { TopologyRef } from "@srl-labs/clab-ui/session";

import {
  extractEndpointIdFromTopologyId,
  normalizePathValue
} from "./standaloneHostShared";

export const STANDALONE_FAVORITES_STORAGE_KEY = "clab-standalone-favorite-labs";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface FavoriteTopologyTarget {
  endpointId?: string;
  topologyRef?: Pick<TopologyRef, "topologyId" | "yamlPath">;
}

function resolveStorage(storage?: StorageLike): StorageLike | undefined {
  if (storage !== undefined) {
    return storage;
  }
  if (typeof localStorage === "undefined") {
    return undefined;
  }
  return localStorage;
}

export function buildFavoriteKey(target: FavoriteTopologyTarget): string | null {
  const endpointId =
    target.endpointId ?? extractEndpointIdFromTopologyId(target.topologyRef?.topologyId);
  const yamlPath = target.topologyRef?.yamlPath;
  if (!endpointId || !yamlPath) {
    return null;
  }

  const normalizedPath = normalizePathValue(yamlPath).toLowerCase();
  if (!normalizedPath) {
    return null;
  }
  return `${endpointId}:${normalizedPath}`;
}

export function loadFavoriteKeys(storage?: StorageLike): Set<string> {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return new Set();
  }

  try {
    const raw = resolvedStorage.getItem(STANDALONE_FAVORITES_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

function persistFavoriteKeys(keys: Set<string>, storage?: StorageLike): void {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return;
  }

  try {
    resolvedStorage.setItem(
      STANDALONE_FAVORITES_STORAGE_KEY,
      JSON.stringify([...keys].sort())
    );
  } catch {
    // Ignore persistence failures.
  }
}

export function isStandaloneFavorite(
  target: FavoriteTopologyTarget,
  storage?: StorageLike
): boolean {
  const key = buildFavoriteKey(target);
  return key !== null && loadFavoriteKeys(storage).has(key);
}

export function toggleStandaloneFavorite(
  target: FavoriteTopologyTarget,
  storage?: StorageLike
): boolean {
  const key = buildFavoriteKey(target);
  if (key === null) {
    return false;
  }

  const keys = loadFavoriteKeys(storage);
  const nextFavorite = !keys.has(key);
  if (nextFavorite) {
    keys.add(key);
  } else {
    keys.delete(key);
  }
  persistFavoriteKeys(keys, storage);
  return nextFavorite;
}
