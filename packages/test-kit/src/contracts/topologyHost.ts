import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ClabUiHost, TopologyUiContext } from "@containerlab/clab-ui/host";
import type { TopologyHostCommand, TopologySnapshot } from "@containerlab/clab-ui/session";

export const CONTRACT_TOPOLOGY_YAML = `name: contract
topology:
  nodes:
    r1:
      kind: linux
      image: alpine:latest
    r2:
      kind: linux
      image: alpine:latest
  links:
    - endpoints: ["r1:eth1", "r2:eth1"]
`;

const EXTERNAL_TOPOLOGY_YAML = `name: external
topology:
  nodes:
    edge:
      kind: linux
      image: alpine:latest
`;

const ADD_NODE: TopologyHostCommand = {
  command: "addNode",
  payload: { id: "r3", name: "r3", extraData: { kind: "linux", image: "alpine:latest" } }
};

/**
 * One host transport under test. Hosts differ in how they reach the shared topology
 * core (window messages, HTTP to the app server, the sandbox transport); the UI sees
 * only `ClabUiHost.topology`, so that is the surface every host must agree on.
 */
export interface TopologyHostContractFixture {
  host: Pick<ClabUiHost, "topology">;
  context: TopologyUiContext;
  readTopology(): Promise<string>;
  /** Changes the YAML without going through the host, like another editor would. */
  writeTopologyExternally(content: string): Promise<void>;
  /** Delivers an external change through the host's own notification path. */
  observeExternalChange(): Promise<TopologySnapshot>;
  dispose?(): Promise<void> | void;
}

export interface TopologyHostContractOptions {
  /** Creates a fresh host whose topology file contains `yaml`. */
  createFixture(yaml: string): Promise<TopologyHostContractFixture>;
}

function nodeIds(snapshot: TopologySnapshot): string[] {
  return snapshot.nodes.map((node) => node.id).sort();
}

export function describeTopologyHostContract(
  hostName: string,
  options: TopologyHostContractOptions
): void {
  async function withFixture(
    run: (fixture: TopologyHostContractFixture) => Promise<void>
  ): Promise<void> {
    const fixture = await options.createFixture(CONTRACT_TOPOLOGY_YAML);
    try {
      await run(fixture);
    } finally {
      await fixture.dispose?.();
    }
  }

  describe(`${hostName} topology host contract`, () => {
    test("loads the document from disk", () =>
      withFixture(async ({ host, context }) => {
        const snapshot = await host.topology.requestSnapshot(context);
        assert.equal(snapshot.labName, "contract");
        assert.deepEqual(nodeIds(snapshot), ["r1", "r2"]);
        assert.equal(snapshot.edges.length, 1);
        assert.equal(snapshot.yamlContent, CONTRACT_TOPOLOGY_YAML);
        assert.equal(snapshot.canUndo, false);
        assert.equal(snapshot.canRedo, false);
      }));

    test("acknowledges a command, persists it and advances the revision", () =>
      withFixture(async ({ host, context, readTopology }) => {
        const before = await host.topology.requestSnapshot(context);
        const response = await host.topology.dispatchCommand(context, before.revision, ADD_NODE);
        assert.ok(response.type === "topology-host:ack", `expected an ack, got ${response.type}`);
        assert.ok(response.revision > before.revision);
        assert.match(await readTopology(), /\n {4}r3:\n/);

        const after = await host.topology.requestSnapshot(context);
        assert.deepEqual(nodeIds(after), ["r1", "r2", "r3"]);
        assert.equal(after.canUndo, true);
      }));

    test("rejects a stale revision without writing", () =>
      withFixture(async ({ host, context, readTopology }) => {
        const before = await host.topology.requestSnapshot(context);
        await host.topology.dispatchCommand(context, before.revision, ADD_NODE);
        const persisted = await readTopology();

        const response = await host.topology.dispatchCommand(context, before.revision, {
          command: "deleteNode",
          payload: { id: "r1" }
        });
        assert.ok(response.type === "topology-host:reject", `expected a reject, got ${response.type}`);
        assert.equal(response.reason, "stale");
        assert.deepEqual(nodeIds(response.snapshot), ["r1", "r2", "r3"]);
        assert.equal(await readTopology(), persisted);
      }));

    test("undo and redo restore the persisted document", () =>
      withFixture(async ({ host, context, readTopology }) => {
        const initial = await host.topology.requestSnapshot(context);
        await host.topology.dispatchCommand(context, initial.revision, ADD_NODE);
        const edited = await readTopology();

        const afterAdd = await host.topology.requestSnapshot(context);
        const undo = await host.topology.dispatchCommand(context, afterAdd.revision, { command: "undo" });
        assert.equal(undo.type, "topology-host:ack");
        assert.equal(await readTopology(), CONTRACT_TOPOLOGY_YAML);
        const undone = await host.topology.requestSnapshot(context);
        assert.deepEqual(nodeIds(undone), ["r1", "r2"]);
        assert.equal(undone.canRedo, true);

        const redo = await host.topology.dispatchCommand(context, undone.revision, { command: "redo" });
        assert.equal(redo.type, "topology-host:ack");
        assert.equal(await readTopology(), edited);
      }));

    test("external edits replace the document and reset history", () =>
      withFixture(async (fixture) => {
        const { host, context } = fixture;
        const before = await host.topology.requestSnapshot(context);
        await host.topology.dispatchCommand(context, before.revision, ADD_NODE);
        const edited = await host.topology.requestSnapshot(context);

        await fixture.writeTopologyExternally(EXTERNAL_TOPOLOGY_YAML);
        const external = await fixture.observeExternalChange();
        assert.equal(external.labName, "external");
        assert.deepEqual(nodeIds(external), ["edge"]);
        assert.ok(external.revision > edited.revision);
        assert.equal(external.canUndo, false);

        const next = await host.topology.dispatchCommand(context, external.revision, ADD_NODE);
        assert.equal(next.type, "topology-host:ack");
      }));

    test("never overwrites an external edit the host has not observed", () =>
      withFixture(async (fixture) => {
        const { host, context, readTopology } = fixture;
        const before = await host.topology.requestSnapshot(context);
        await fixture.writeTopologyExternally(EXTERNAL_TOPOLOGY_YAML);

        const response = await host.topology.dispatchCommand(context, before.revision, ADD_NODE);
        assert.ok(response.type === "topology-host:reject", `expected a reject, got ${response.type}`);
        assert.deepEqual(nodeIds(response.snapshot), ["edge"]);
        assert.equal(await readTopology(), EXTERNAL_TOPOLOGY_YAML);
      }));

    test("repeated snapshot requests keep the revision and history", () =>
      withFixture(async ({ host, context }) => {
        const before = await host.topology.requestSnapshot(context);
        await host.topology.dispatchCommand(context, before.revision, ADD_NODE);
        const first = await host.topology.requestSnapshot(context);
        const second = await host.topology.requestSnapshot(context);
        assert.equal(second.revision, first.revision);
        assert.equal(second.canUndo, true);
      }));
  });
}
