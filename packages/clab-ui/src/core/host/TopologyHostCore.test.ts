import assert from "node:assert/strict";
import { posix as path } from "node:path";
import test from "node:test";

import { TopologyHostCore } from "./TopologyHostCore";
import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "../types/messages";
import type { FileSystemAdapter } from "../io/types";

type AckWithSnapshot = Extract<
  TopologyHostResponseMessage,
  { type: "topology-host:ack" }
> & { snapshot: TopologySnapshot };

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

const BASE_YAML = `name: demo
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
  links: []
`;

const CHANGED_YAML = `name: demo
topology:
  nodes:
    srl1:
      kind: nokia_srlinux
    srl2:
      kind: nokia_srlinux
  links: []
`;

function assertAck(response: TopologyHostResponseMessage): asserts response is Extract<
  TopologyHostResponseMessage,
  { type: "topology-host:ack" }
> {
  assert.equal(response.type, "topology-host:ack");
}

async function apply(
  host: TopologyHostCore,
  revision: number,
  command: TopologyHostCommand
): Promise<AckWithSnapshot> {
  const response = await host.applyCommand(command, revision);
  assertAck(response);
  assert.ok(response.snapshot);
  return response as AckWithSnapshot;
}

test("annotation-only commands do not dirty deployed apply state", async () => {
  const fs = new MemoryFileSystemAdapter();
  const yamlPath = "/labs/demo.clab.yml";
  await fs.writeFile(yamlPath, BASE_YAML);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath: yamlPath,
    mode: "edit",
    deploymentState: "deployed",
    dirty: false
  });

  const initial = await host.getSnapshot();
  assert.equal(initial.dirty, false);

  const annotationResponse = await apply(host, initial.revision, {
    command: "setAnnotations",
    payload: {
      freeTextAnnotations: [
        {
          id: "note-1",
          text: "hello",
          position: { x: 10, y: 20 }
        }
      ]
    }
  });
  assert.equal(annotationResponse.snapshot.dirty, false);

  const positionResponse = await apply(host, annotationResponse.revision, {
    command: "savePositions",
    payload: [{ id: "srl1", position: { x: 100, y: 200 } }]
  });
  assert.equal(positionResponse.snapshot.dirty, false);

  const yamlResponse = await apply(host, positionResponse.revision, {
    command: "setYamlContent",
    payload: { content: CHANGED_YAML }
  });
  assert.equal(yamlResponse.snapshot.dirty, true);
});
