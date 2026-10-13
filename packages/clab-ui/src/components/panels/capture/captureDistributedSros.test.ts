// Capture options for a distributed SR-SIM node, built from data recorded on
// a deployed lab (containerlab 0.81, nokia_srsim 26.3.R1, sr-7 with slots A, 1, 2).
import assert from "node:assert/strict";
import { posix as path } from "node:path";
import test from "node:test";

import type { Edge, Node } from "@xyflow/react";

import { TopologyHostCore } from "../../../core/host/TopologyHostCore";
import type { FileSystemAdapter } from "../../../core/io/types";
import type { HostRuntimeContainer, HostRuntimeInterface } from "../../../host";
import { createRuntimeContainerDataProvider } from "../../../topology/runtime";
import { buildEdgeContextMenu } from "../../canvas/contextMenuBuilders";

import { buildCaptureNodeTarget, groupCaptureSelection } from "./captureInterfaceOptions";

class MemoryFileSystemAdapter implements FileSystemAdapter {
  private readonly files = new Map<string, string>();

  async readFile(filePath: string): Promise<string> {
    const content = this.files.get(path.normalize(filePath));
    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" });
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(path.normalize(filePath), content);
  }

  async unlink(filePath: string): Promise<void> {
    this.files.delete(path.normalize(filePath));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.writeFile(newPath, await this.readFile(oldPath));
    await this.unlink(oldPath);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(path.normalize(filePath));
  }

  dirname(filePath: string): string {
    return path.dirname(filePath);
  }

  basename(filePath: string): string {
    return path.basename(filePath);
  }

  join(...segments: string[]): string {
    return path.join(...segments);
  }
}

const TOPOLOGY = `name: capdist
topology:
  nodes:
    sr1:
      kind: nokia_srsim
      type: sr-7
      components:
        - slot: A
        - slot: 1
        - slot: 2
    client1:
      kind: linux
    client2:
      kind: linux
  links:
    - endpoints: ["sr1:1/1/c1/1", "client1:eth1"]
    - endpoints: ["sr1:1/1/c2/1", "client1:eth2"]
    - endpoints: ["sr1:2/1/c1/1", "client2:eth1"]
`;

function iface(name: string, alias: string, state = "up"): HostRuntimeInterface {
  return { name, alias, mac: "", mtu: 9500, state, type: "veth" };
}

function container(
  nodeName: string,
  kind: string,
  interfaces: HostRuntimeInterface[]
): HostRuntimeContainer {
  return {
    name: `clab-capdist-${nodeName}`,
    nodeName,
    labName: "capdist",
    state: "running",
    kind,
    image: "",
    ipv4Address: "",
    ipv6Address: "",
    interfaces
  };
}

// Line cards and the netns holder are hidden from inspect; sr1-a reports every
// port. Links appear as host-side clab-s-* interfaces aliased to the port name.
const RUNTIME_CONTAINERS: HostRuntimeContainer[] = [
  container("client1", "linux", [
    iface("clab-s-82b47fe6", "eth2"),
    iface("clab-s-d2115f7f", "eth1"),
    iface("eth0", ""),
    iface("lo", "", "unknown")
  ]),
  container("client2", "linux", [iface("clab-s-9d01a3df", "eth1"), iface("eth0", "")]),
  container("sr1-a", "nokia_srsim", [
    iface("_nokia_fab1_br", ""),
    iface("_nokia_fabric", ""),
    iface("_nokia_mgmt1", "", "unknown"),
    iface("clab-s-6b26d4e7", "1/1/c1/1"),
    iface("clab-s-8b54dd8d", "2/1/c1/1"),
    iface("clab-s-9ded930f", "1/1/c2/1"),
    iface("eth0", ""),
    iface("lo", "", "unknown")
  ])
];

async function deployedSnapshot(
  containers: HostRuntimeContainer[] = RUNTIME_CONTAINERS
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const fs = new MemoryFileSystemAdapter();
  const yamlFilePath = "/labs/capdist.clab.yml";
  await fs.writeFile(yamlFilePath, TOPOLOGY);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath,
    mode: "view",
    deploymentState: "deployed",
    containerDataProvider: createRuntimeContainerDataProvider(containers)
  });
  const snapshot = await host.getSnapshot();
  return { nodes: snapshot.nodes, edges: snapshot.edges };
}

test("a distributed SR-SIM node lists its ports by SR OS name, without simulator internals", async () => {
  const { nodes, edges } = await deployedSnapshot();
  const target = buildCaptureNodeTarget("sr1", nodes, edges);
  assert.ok(target);

  assert.equal(target.containerName, "clab-capdist-sr1-a");
  // Link ports are captured under their name inside the node, not the host-side clab-s-* end.
  assert.deepEqual(
    target.options.map((option) => [option.label, option.name, option.peer?.node ?? null]),
    [
      ["eth0", "eth0", null],
      ["1/1/c1/1", "e1-1-c1-1", "client1"],
      ["1/1/c2/1", "e1-1-c2-1", "client1"],
      ["2/1/c1/1", "e2-1-c1-1", "client2"]
    ]
  );
  assert.equal(target.options[1].detail, "e1-1-c1-1");
});

test("eth0 and every port of the SR-SIM node stream into one capture inside the node", async () => {
  const { nodes, edges } = await deployedSnapshot();
  const target = buildCaptureNodeTarget("sr1", nodes, edges);
  assert.ok(target);

  const everything = new Set(target.options.map((option) => option.name));
  assert.deepEqual(groupCaptureSelection(target.options, everything), [
    {
      containerName: "clab-capdist-sr1-a",
      interfaceNames: ["eth0", "e1-1-c1-1", "e1-1-c2-1", "e2-1-c1-1"],
      nodeNamespace: true
    }
  ]);
});

test("one capture per interface splits the selection", async () => {
  const { nodes, edges } = await deployedSnapshot();
  const target = buildCaptureNodeTarget("sr1", nodes, edges);
  assert.ok(target);

  const groups = groupCaptureSelection(target.options, new Set(["eth0", "e2-1-c1-1"]), {
    separate: true
  });
  assert.deepEqual(groups, [
    { containerName: "clab-capdist-sr1-a", interfaceNames: ["eth0"], nodeNamespace: true },
    { containerName: "clab-capdist-sr1-a", interfaceNames: ["e2-1-c1-1"], nodeNamespace: true }
  ]);
});

test("a linux peer shows its own port names for links into the SR-SIM node", async () => {
  const { nodes, edges } = await deployedSnapshot();
  const target = buildCaptureNodeTarget("client1", nodes, edges);
  assert.ok(target);

  assert.deepEqual(
    target.options.map((option) => [option.label, option.peer?.endpoint ?? null]),
    [
      ["eth0", null],
      ["eth1", "1/1/c1/1"],
      ["eth2", "1/1/c2/1"]
    ]
  );
});

test("a link's capture checklist sends the SR-SIM container and the SR OS port name", async () => {
  const { edges } = await deployedSnapshot();
  const sent: Array<[string, string]> = [];

  for (const edge of edges) {
    const data = edge.data as { sourceEndpoint?: string; targetEndpoint?: string; extraData?: Record<string, unknown> };
    const items = buildEdgeContextMenu({
      targetId: edge.id,
      sourceNode: edge.source,
      targetNode: edge.target,
      sourceEndpoint: data.sourceEndpoint,
      targetEndpoint: data.targetEndpoint,
      extraData: data.extraData,
      isEditMode: false,
      isDeployed: true,
      isLocked: false,
      renderLinkCapturePanel: ({ ends }) => {
        for (const end of ends) sent.push([end.captureName, end.endpoint]);
        return null;
      },
      closeContextMenu: () => {},
      editEdge: () => {},
      handleDeleteEdge: () => {}
    });
    for (const item of items.filter((candidate) => candidate.id.startsWith("capture-"))) {
      assert.equal(item.panel?.(() => {}), null);
    }
  }

  // Hosts resolve the port name through the interface alias to the host-side clab-s-* interface.
  assert.deepEqual(sent, [
    ["clab-capdist-sr1-a", "1/1/c1/1"],
    ["clab-capdist-client1", "eth1"],
    ["clab-capdist-sr1-a", "1/1/c2/1"],
    ["clab-capdist-client1", "eth2"],
    ["clab-capdist-sr1-a", "2/1/c1/1"],
    ["clab-capdist-client2", "eth1"]
  ]);
});

test("the canvas picker lists each port once when every SR-SIM sub-container is reported", async () => {
  // VS Code inspects with --details: the line cards and the netns holder show up
  // too, all named after the root node and listing the same shared ports.
  const sr1a = RUNTIME_CONTAINERS[2];
  const subContainers = ["1", "2", "a", "netns"].map((suffix) => ({
    ...sr1a,
    name: `clab-capdist-sr1-${suffix}`,
    nodeName: "sr1"
  }));
  const { nodes, edges } = await deployedSnapshot([...RUNTIME_CONTAINERS.slice(0, 2), ...subContainers]);
  const target = buildCaptureNodeTarget("sr1", nodes, edges);
  assert.ok(target);

  assert.deepEqual(
    target.options.map((option) => option.label),
    ["eth0", "1/1/c1/1", "1/1/c2/1", "2/1/c1/1"]
  );
  const everything = new Set(target.options.map((option) => option.name));
  assert.equal(groupCaptureSelection(target.options, everything).length, 1);
});
