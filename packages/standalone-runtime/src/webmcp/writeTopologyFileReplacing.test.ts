import assert from "node:assert/strict";
import test from "node:test";

import type { TopologyRef } from "@containerlab/clab-ui/session";

import { writeTopologyFileReplacing } from "./writeTopologyFileReplacing";

function ref(fileName: string): TopologyRef {
  return {
    topologyId: `standalone:pages-sandbox::${fileName}`,
    labName: "lab",
    yamlPath: fileName,
    source: "standalone",
  };
}

test("writeTopologyFileReplacing creates a new file in one call", async () => {
  const calls: string[] = [];
  const created = await writeTopologyFileReplacing("lab.clab.yml", "name: lab\n", {
    async createTopologyFile(input) {
      calls.push(`create:${input.fileName}`);
      return { topologyRef: ref(input.fileName) };
    },
    async deleteTopologyFile() {
      calls.push("delete");
      return {};
    },
  });
  assert.equal(created.topologyRef.yamlPath, "lab.clab.yml");
  assert.deepEqual(calls, ["create:lab.clab.yml"]);
});

test("writeTopologyFileReplacing replaces an existing file and writes once more", async () => {
  const calls: string[] = [];
  let exists = true;
  const created = await writeTopologyFileReplacing("lab.clab.yml", "name: lab\n", {
    async createTopologyFile(input) {
      calls.push(`create:${input.content}`);
      if (exists) {
        exists = false;
        throw new Error(`${input.fileName} already exists`);
      }
      return { topologyRef: ref(input.fileName) };
    },
    async deleteTopologyFile(target) {
      calls.push(`delete:${target.topologyRef.yamlPath}`);
      return {};
    },
  });
  assert.equal(created.topologyRef.yamlPath, "lab.clab.yml");
  assert.deepEqual(calls, [
    "create:name: lab\n",
    "delete:lab.clab.yml",
    "create:name: lab\n",
  ]);
});
