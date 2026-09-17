import assert from "node:assert/strict";
import test from "node:test";

import {
  nextExpandedBySectionForSnapshot,
  nextExpandedItemsForNodeToggle,
  shouldPersistExpandedSectionImmediately,
  withExpandedSectionItems
} from "./explorerUiState";
import type { ExplorerNode, ExplorerSectionSnapshot } from "./shared/explorer/types";

function node(id: string, children: ExplorerNode[] = [], hasChildren = children.length > 0): ExplorerNode {
  return {
    id,
    label: id,
    hasChildren,
    actions: [],
    children
  };
}

function section(id: ExplorerSectionSnapshot["id"], nodes: ExplorerNode[]): ExplorerSectionSnapshot {
  return {
    id,
    label: id,
    count: nodes.length,
    nodes,
    toolbarActions: []
  };
}

test("snapshot expansion updates keep file explorer ids sticky", () => {
  const current = {
    runningLabs: ["running-old"],
    fileExplorer: ["file-root:endpoint-1", "file:endpoint-1:configs"]
  };

  const next = nextExpandedBySectionForSnapshot({
    current,
    expandedBeforeFilter: null,
    filterText: "",
    sections: [section("fileExplorer", [node("file-root:endpoint-1")])]
  });

  assert.deepEqual(next.expandedBySection?.fileExplorer, [
    "file-root:endpoint-1",
    "file:endpoint-1:configs"
  ]);
});

test("clearing filter restores lab expansion without undoing file explorer collapse", () => {
  const beforeFilter = {
    runningLabs: ["running-original"],
    localLabs: ["local-original"],
    fileExplorer: ["file-root:endpoint-1", "file:endpoint-1:configs"]
  };
  const filtered = nextExpandedBySectionForSnapshot({
    current: beforeFilter,
    expandedBeforeFilter: null,
    filterText: "lab",
    sections: [
      section("runningLabs", [node("running-filtered", [], true)]),
      section("localLabs", [node("local-filtered", [], true)])
    ]
  });

  assert.deepEqual(filtered.expandedBySection?.runningLabs, ["running-filtered"]);
  assert.deepEqual(filtered.expandedBySection?.fileExplorer, [
    "file-root:endpoint-1",
    "file:endpoint-1:configs"
  ]);

  const userCollapsedFileFolder = {
    ...filtered.expandedBySection,
    fileExplorer: ["file-root:endpoint-1"]
  };
  const restored = nextExpandedBySectionForSnapshot({
    current: userCollapsedFileFolder,
    expandedBeforeFilter: filtered.expandedBeforeFilter,
    filterText: "",
    sections: [section("runningLabs", [node("running-original")])]
  });

  assert.deepEqual(restored.expandedBySection?.runningLabs, ["running-original"]);
  assert.deepEqual(restored.expandedBySection?.localLabs, ["local-original"]);
  assert.deepEqual(restored.expandedBySection?.fileExplorer, ["file-root:endpoint-1"]);
});

test("file explorer folder collapse removes only the explicit node", () => {
  const next = nextExpandedItemsForNodeToggle({
    descendantIds: ["file:endpoint-1:configs/nested"],
    expandedItems: [
      "file-root:endpoint-1",
      "file:endpoint-1:configs",
      "file:endpoint-1:configs/nested"
    ],
    nodeId: "file:endpoint-1:configs",
    resetDescendants: false
  });

  assert.deepEqual(next, ["file-root:endpoint-1", "file:endpoint-1:configs/nested"]);
});

test("endpoint collapse still removes descendant expansion", () => {
  const next = nextExpandedItemsForNodeToggle({
    descendantIds: ["endpoint-section:running:endpoint-1", "container:node1"],
    expandedItems: ["endpoint:endpoint-1", "endpoint-section:running:endpoint-1", "container:node1"],
    nodeId: "endpoint:endpoint-1",
    resetDescendants: true
  });

  assert.deepEqual(next, []);
});

test("file explorer expansion is the only immediately persisted section", () => {
  assert.equal(shouldPersistExpandedSectionImmediately("fileExplorer"), true);
  assert.equal(shouldPersistExpandedSectionImmediately("runningLabs"), false);
});

test("withExpandedSectionItems replaces only the requested section", () => {
  const next = withExpandedSectionItems(
    {
      runningLabs: ["running"],
      fileExplorer: ["file-root:endpoint-1"]
    },
    "fileExplorer",
    ["file-root:endpoint-1", "file:endpoint-1:configs"]
  );

  assert.deepEqual(next, {
    runningLabs: ["running"],
    fileExplorer: ["file-root:endpoint-1", "file:endpoint-1:configs"]
  });
});
