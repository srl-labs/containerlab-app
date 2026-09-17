import assert from "node:assert/strict";
import { posix as path } from "node:path";
import test from "node:test";

import * as YAML from "yaml";

import type { TopologyAnnotations } from "../types/topology";

import { AnnotationsIO } from "./AnnotationsIO";
import { TopologyIO, migrateGeneratedNetworkNodeAnnotations } from "./TopologyIO";
import type { FileSystemAdapter } from "./types";

class MemoryFileSystemAdapter implements FileSystemAdapter {
  private readonly files = new Map<string, string>();

  async readFile(filePath: string): Promise<string> {
    const content = this.files.get(this.key(filePath));
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as Error & {
        code: string;
      };
      error.code = "ENOENT";
      throw error;
    }
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(this.key(filePath), content);
  }

  async unlink(filePath: string): Promise<void> {
    this.files.delete(this.key(filePath));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const oldKey = this.key(oldPath);
    const content = this.files.get(oldKey);
    if (content === undefined) {
      const error = new Error(`ENOENT: no such file or directory, rename '${oldPath}'`) as Error & {
        code: string;
      };
      error.code = "ENOENT";
      throw error;
    }
    this.files.set(this.key(newPath), content);
    this.files.delete(oldKey);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(this.key(filePath));
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

  private key(filePath: string): string {
    return path.normalize(filePath);
  }
}

function createTopologyIoHarness(): {
  fs: MemoryFileSystemAdapter;
  annotationsIO: AnnotationsIO;
  topologyIO: TopologyIO;
  yamlPath: string;
} {
  const fs = new MemoryFileSystemAdapter();
  const annotationsIO = new AnnotationsIO({ fs, cacheTtlMs: 0 });
  const topologyIO = new TopologyIO({ fs, annotationsIO });
  const yamlPath = "/labs/dfg.clab.yml";

  topologyIO.initialize(YAML.parseDocument("topology: {}\n"), yamlPath);

  return { fs, annotationsIO, topologyIO, yamlPath };
}

async function loadSavedAnnotations(
  fs: MemoryFileSystemAdapter,
  annotationsPath: string
): Promise<TopologyAnnotations> {
  return JSON.parse(await fs.readFile(annotationsPath)) as TopologyAnnotations;
}

test("savePositions stores generated macvlan nodes as network annotations", async () => {
  const { fs, annotationsIO, topologyIO, yamlPath } = createTopologyIoHarness();
  const annotationsPath = annotationsIO.getAnnotationsFilePath(yamlPath);

  await fs.writeFile(
    annotationsPath,
    JSON.stringify({
      networkNodeAnnotations: [],
      nodeAnnotations: [
        {
          id: "macvlan:ens33",
          label: "uplink",
          position: { x: 1, y: 2 },
          geoCoordinates: { lat: 48, lng: 11 }
        },
        { id: "spine1", position: { x: 3, y: 4 } }
      ]
    })
  );

  const result = await topologyIO.savePositions([
    { id: "macvlan:ens33", position: { x: 120, y: 220 } },
    { id: "spine1", position: { x: 10, y: 20 } }
  ]);

  assert.deepEqual(result, { success: true });

  const saved = await loadSavedAnnotations(fs, annotationsPath);
  assert.deepEqual(
    saved.networkNodeAnnotations?.find((entry) => entry.id === "macvlan:ens33"),
    {
      id: "macvlan:ens33",
      type: "macvlan",
      label: "uplink",
      position: { x: 120, y: 220 },
      geoCoordinates: { lat: 48, lng: 11 }
    }
  );
  assert.equal(
    saved.nodeAnnotations?.some((entry) => entry.id === "macvlan:ens33"),
    false
  );
  assert.deepEqual(
    saved.nodeAnnotations?.find((entry) => entry.id === "spine1"),
    {
      id: "spine1",
      position: { x: 10, y: 20 }
    }
  );
});

test("migrateGeneratedNetworkNodeAnnotations converts stale macvlan node annotations", () => {
  const annotations: TopologyAnnotations = {
    networkNodeAnnotations: [],
    nodeAnnotations: [
      {
        id: "macvlan:ens33",
        label: "uplink",
        position: { x: 1180, y: 80 }
      },
      {
        id: "spine1",
        position: { x: 1240, y: 200 }
      }
    ]
  };

  const modified = migrateGeneratedNetworkNodeAnnotations(annotations);

  assert.equal(modified, true);
  assert.deepEqual(annotations.networkNodeAnnotations, [
    {
      id: "macvlan:ens33",
      type: "macvlan",
      label: "uplink",
      position: { x: 1180, y: 80 }
    }
  ]);
  assert.deepEqual(annotations.nodeAnnotations, [
    {
      id: "spine1",
      position: { x: 1240, y: 200 }
    }
  ]);
});

test("migrating dummy positions preserves membership and visual metadata and is idempotent", () => {
  const annotations: TopologyAnnotations = {
    nodeAnnotations: [
      { id: "dummy0", position: { x: 21.5, y: -21.5 }, groupId: "group-1", labelPosition: "top" },
      { id: "dummy1", groupId: "group-1" },
      { id: "dummy-router", position: { x: 100, y: 200 }, icon: "router" }
    ],
    networkNodeAnnotations: [{ id: "dummy1", type: "dummy", position: { x: 300, y: 400 } }]
  };
  const topologyNodeIds = new Set(["dummy-router"]);

  assert.equal(migrateGeneratedNetworkNodeAnnotations(annotations, topologyNodeIds), true);
  assert.deepEqual(annotations.nodeAnnotations, [
    { id: "dummy0", groupId: "group-1", labelPosition: "top" },
    { id: "dummy1", groupId: "group-1" },
    { id: "dummy-router", position: { x: 100, y: 200 }, icon: "router" }
  ]);
  assert.deepEqual(
    annotations.networkNodeAnnotations?.find((node) => node.id === "dummy0")?.position,
    { x: 21.5, y: -21.5 }
  );
  assert.equal(
    annotations.networkNodeAnnotations.some((node) => node.id === "dummy-router"),
    false
  );
  assert.equal(migrateGeneratedNetworkNodeAnnotations(annotations, topologyNodeIds), false);
});

test("savePositions preserves dummy group membership and treats declared dummy-router as a regular node", async () => {
  const { fs, annotationsIO, topologyIO, yamlPath } = createTopologyIoHarness();
  topologyIO.initialize(
    YAML.parseDocument("topology:\n  nodes:\n    dummy-router:\n      kind: linux\n"),
    yamlPath
  );
  const annotationsPath = annotationsIO.getAnnotationsFilePath(yamlPath);
  await fs.writeFile(
    annotationsPath,
    JSON.stringify({
      nodeAnnotations: [
        { id: "dummy0", groupId: "group-1" },
        { id: "dummy-router", icon: "router" }
      ]
    })
  );

  assert.deepEqual(
    await topologyIO.savePositions([
      { id: "dummy0", position: { x: 21.5, y: -21.5 } },
      { id: "dummy-router", position: { x: 100, y: 200 } }
    ]),
    { success: true }
  );
  const saved = await loadSavedAnnotations(fs, annotationsPath);
  assert.deepEqual(saved.nodeAnnotations, [
    { id: "dummy0", groupId: "group-1" },
    { id: "dummy-router", icon: "router", position: { x: 100, y: 200 } }
  ]);
  assert.deepEqual(
    saved.networkNodeAnnotations?.map((node) => node.id),
    ["dummy0"]
  );
});
