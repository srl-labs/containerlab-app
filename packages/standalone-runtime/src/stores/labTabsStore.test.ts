import assert from "node:assert/strict";
import test from "node:test";

import { type TopologyRef } from "@srl-labs/clab-ui/session";

import { resolveLabTab, useLabTabsStore } from "./labTabsStore";

function makeTopologyRef(path: string, labName: string, endpointId: string): TopologyRef {
  return {
    topologyId: `standalone:${endpointId}::${path}`,
    labName,
    yamlPath: path,
    annotationsPath: `${path}.annotations.json`,
    source: "standalone"
  };
}

function tabIdAt(index: number): string {
  const tab = useLabTabsStore.getState().tabs[index];
  if (!tab) {
    throw new Error(`Missing tab at index ${index}`);
  }
  return tab.id;
}

test.beforeEach(() => {
  useLabTabsStore.getState().clear();
});

test("openOrFocusTab adds once and focuses existing tabs without duplicates", () => {
  const store = useLabTabsStore.getState();
  const tab = resolveLabTab({
    topologyRef: makeTopologyRef("/labs/demo.clab.yml", "demo", "ep-1")
  });

  const first = store.openOrFocusTab(tab);
  assert.equal(first.alreadyOpen, false);
  assert.equal(useLabTabsStore.getState().tabs.length, 1);
  assert.equal(useLabTabsStore.getState().activeTabId, tab.id);

  const second = useLabTabsStore.getState().openOrFocusTab(tab);
  assert.equal(second.alreadyOpen, true);
  assert.equal(useLabTabsStore.getState().tabs.length, 1);
  assert.equal(useLabTabsStore.getState().activeTabId, tab.id);
});

test("closeTab prefers right neighbor, then left neighbor", () => {
  const store = useLabTabsStore.getState();
  const tabs = [
    resolveLabTab({ topologyRef: makeTopologyRef("/labs/a.clab.yml", "a", "ep-1") }),
    resolveLabTab({ topologyRef: makeTopologyRef("/labs/b.clab.yml", "b", "ep-1") }),
    resolveLabTab({ topologyRef: makeTopologyRef("/labs/c.clab.yml", "c", "ep-1") })
  ];
  tabs.forEach((tab) => {
    useLabTabsStore.getState().openOrFocusTab(tab);
  });

  store.setActiveTab(tabIdAt(1));
  const closeMiddle = store.closeTab(tabIdAt(1));
  assert.equal(closeMiddle.removed, true);
  assert.equal(closeMiddle.wasActive, true);
  assert.equal(closeMiddle.nextActiveTabId, tabIdAt(1));

  const closeActiveRightMost = useLabTabsStore.getState().closeTab(tabIdAt(1));
  assert.equal(closeActiveRightMost.removed, true);
  assert.equal(closeActiveRightMost.wasActive, true);
  assert.equal(closeActiveRightMost.nextActiveTabId, tabIdAt(0));
});

test("closeTab clears active tab when closing the last tab", () => {
  const store = useLabTabsStore.getState();
  const tab = resolveLabTab({
    topologyRef: makeTopologyRef("/labs/only.clab.yml", "only", "ep-1")
  });

  store.openOrFocusTab(tab);
  const result = useLabTabsStore.getState().closeTab(tab.id);

  assert.equal(result.removed, true);
  assert.equal(result.wasActive, true);
  assert.equal(result.nextActiveTabId, null);
  assert.equal(useLabTabsStore.getState().tabs.length, 0);
  assert.equal(useLabTabsStore.getState().activeTabId, null);
});

test("closeTabsByEndpoint removes all endpoint tabs and selects next active", () => {
  const store = useLabTabsStore.getState();
  const first = resolveLabTab({
    topologyRef: makeTopologyRef("/labs/a.clab.yml", "a", "ep-1")
  });
  const second = resolveLabTab({
    topologyRef: makeTopologyRef("/labs/b.clab.yml", "b", "ep-2")
  });
  const third = resolveLabTab({
    topologyRef: makeTopologyRef("/labs/c.clab.yml", "c", "ep-1")
  });

  store.openOrFocusTab(first);
  store.openOrFocusTab(second);
  store.openOrFocusTab(third);
  store.setActiveTab(second.id);

  const result = useLabTabsStore.getState().closeTabsByEndpoint("ep-2");
  assert.equal(result.removedCount, 1);
  assert.equal(result.removedWasActive, true);
  assert.equal(result.nextActiveTabId, third.id);
  assert.deepEqual(useLabTabsStore.getState().tabs.map((tab) => tab.id), [first.id, third.id]);
  assert.equal(useLabTabsStore.getState().activeTabId, third.id);
});

test("resolveLabTab applies endpoint fallback and normalizes standalone refs", () => {
  const topologyRef: TopologyRef = {
    topologyId: "standalone:demo.clab.yml",
    labName: " demo-lab ",
    yamlPath: "./demo.clab.yml",
    annotationsPath: "",
    source: "standalone"
  };
  const tab = resolveLabTab(
    {
      topologyRef
    },
    "ep-fallback"
  );

  assert.equal(tab.endpointId, "ep-fallback");
  assert.equal(tab.topologyRef.topologyId, "standalone:ep-fallback::demo.clab.yml");
  assert.equal(tab.topologyRef.yamlPath, "demo.clab.yml");
  assert.equal(tab.topologyRef.labName, "demo-lab");
});
