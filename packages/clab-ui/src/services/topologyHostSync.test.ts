import assert from "node:assert/strict";
import { test } from "node:test";

import type { TopologySnapshot } from "../core/types/messages";
import type { TopoNode } from "../core/types/graph";
import type { TopologySessionClient } from "../session/client";
import { useGraphStore } from "../stores/graphStore";
import { useTopoViewerStore } from "../stores/topoViewerStore";

import { applySnapshotToStores } from "./topologyHostSync";

function createSessionClient(): TopologySessionClient {
  let revision = 0;
  return {
    async dispatchCommand() {
      throw new Error("dispatchCommand should not be called");
    },
    getContext() {
      return {};
    },
    getRevision() {
      return revision;
    },
    async requestSnapshot() {
      throw new Error("requestSnapshot should not be called");
    },
    setContext() {},
    setRevision(nextRevision) {
      revision = nextRevision;
    }
  };
}

function createSnapshot(nodes: TopoNode[]): TopologySnapshot {
  return {
    revision: 7,
    nodes,
    edges: [],
    annotations: {
      nodeAnnotations: [
        {
          id: "spine1",
          position: { x: 320, y: 160 }
        }
      ],
      networkNodeAnnotations: [
        {
          id: "macvlan:ens33",
          type: "macvlan",
          label: "macvlan:ens33",
          position: { x: 1280, y: 80 }
        }
      ]
    },
    yamlFileName: "dfg.clab.yml",
    annotationsFileName: "dfg.clab.yml.annotations.json",
    yamlContent: "",
    annotationsContent: "",
    labName: "dfg",
    mode: "edit",
    deploymentState: "undeployed",
    canUndo: false,
    canRedo: false
  };
}

test("applySnapshotToStores keeps graph positions aligned with annotations", () => {
  useGraphStore.getState().setGraph([], []);
  const nodes: TopoNode[] = [
    {
      id: "spine1",
      type: "topology-node",
      position: { x: 0, y: 0 },
      data: { label: "spine1", role: "router" }
    },
    {
      id: "macvlan:ens33",
      type: "network-node",
      position: { x: 0, y: 0 },
      data: { label: "macvlan:ens33", nodeType: "macvlan" }
    }
  ];

  applySnapshotToStores(createSnapshot(nodes), {}, createSessionClient());

  const graphNodes = useGraphStore.getState().nodes;
  assert.deepEqual(graphNodes.find((node) => node.id === "spine1")?.position, {
    x: 320,
    y: 160
  });
  assert.deepEqual(graphNodes.find((node) => node.id === "macvlan:ens33")?.position, {
    x: 1280,
    y: 80
  });
});

test("applySnapshotToStores does not dirty apply state for annotation-only snapshots", () => {
  const yamlContent = "name: demo\ntopology: {}\n";
  useGraphStore.getState().setGraph([], []);
  useTopoViewerStore.setState({
    deploymentState: "deployed",
    yamlContent,
    cleanYamlContent: yamlContent,
    isDirty: false
  });

  applySnapshotToStores(
    {
      ...createSnapshot([]),
      deploymentState: "deployed",
      yamlContent,
      dirty: true,
      annotations: {
        freeTextAnnotations: [
          {
            id: "note-1",
            text: "hello",
            position: { x: 10, y: 20 }
          }
        ]
      }
    },
    {},
    createSessionClient()
  );

  assert.equal(useTopoViewerStore.getState().isDirty, false);
});

test("applySnapshotToStores dirties apply state when YAML changes from the clean baseline", () => {
  const cleanYamlContent = "name: demo\ntopology: {}\n";
  useGraphStore.getState().setGraph([], []);
  useTopoViewerStore.setState({
    deploymentState: "deployed",
    yamlContent: cleanYamlContent,
    cleanYamlContent,
    isDirty: false
  });

  applySnapshotToStores(
    {
      ...createSnapshot([]),
      deploymentState: "deployed",
      yamlContent: "name: demo\ntopology:\n  nodes: {}\n",
      annotations: {}
    },
    {},
    createSessionClient()
  );

  assert.equal(useTopoViewerStore.getState().isDirty, true);
});

test("applySnapshotToStores does not reuse the clean YAML baseline across topology files", () => {
  const cleanYamlContent = "name: first\ntopology: {}\n";
  useGraphStore.getState().setGraph([], []);
  useTopoViewerStore.setState({
    yamlFileName: "first.clab.yml",
    deploymentState: "deployed",
    yamlContent: cleanYamlContent,
    cleanYamlContent,
    isDirty: false
  });

  applySnapshotToStores(
    {
      ...createSnapshot([]),
      yamlFileName: "second.clab.yml",
      annotationsFileName: "second.clab.yml.annotations.json",
      deploymentState: "deployed",
      yamlContent: "name: second\ntopology: {}\n",
      annotations: {}
    },
    {},
    createSessionClient()
  );

  const state = useTopoViewerStore.getState();
  assert.equal(state.isDirty, undefined);
  assert.equal(state.cleanYamlContent, undefined);
});
