import assert from "node:assert/strict";
import test from "node:test";

import {
  labSettingsKey,
  lifecycleOptionsWithLabSettings,
  readLabSettings,
  writeLabSettings
} from "./standaloneLabSettings";
import type { StorageLike } from "./standaloneFavorites";

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value)
  };
}

const lab = { topologyRef: { topologyId: "standalone:cluster::demo/demo.clab.yml", yamlPath: "demo/demo.clab.yml" } };
const sameFileElsewhere = { topologyRef: { topologyId: "standalone:docker::demo/demo.clab.yml", yamlPath: "demo/demo.clab.yml" } };

test("lab settings are kept per lab host and topology file", () => {
  const storage = memoryStorage();
  assert.equal(labSettingsKey(lab), "cluster:demo/demo.clab.yml");
  writeLabSettings(lab, { timeout: "30m", namespace: "team-a", nodeFilter: ["r1"] } as never, storage);
  assert.deepEqual(readLabSettings(lab, storage), { timeout: "30m", namespace: "team-a" });
  assert.equal(readLabSettings(sameFileElsewhere, storage), undefined);
  writeLabSettings(lab, undefined, storage);
  assert.equal(readLabSettings(lab, storage), undefined);
});

test("runs without options use the lab's settings; Run with options uses its own", () => {
  const storage = memoryStorage();
  writeLabSettings(lab, { timeout: "30m", maxWorkers: 2, namespace: "team-a" }, storage);
  assert.deepEqual(lifecycleOptionsWithLabSettings("redeploy", undefined, lab, storage), {
    timeout: "30m",
    maxWorkers: 2,
    namespace: "team-a"
  });
  assert.deepEqual(lifecycleOptionsWithLabSettings("destroy", undefined, lab, storage), {
    timeout: "30m",
    namespace: "team-a"
  });
  assert.deepEqual(lifecycleOptionsWithLabSettings("deploy", { maxWorkers: 5 }, lab, storage), { maxWorkers: 5 });
  assert.equal(lifecycleOptionsWithLabSettings("deploy", undefined, sameFileElsewhere, storage), undefined);
});
