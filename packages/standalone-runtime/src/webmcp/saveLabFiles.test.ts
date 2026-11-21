import assert from "node:assert/strict";
import test from "node:test";

import type { TopologyRef } from "@containerlab/clab-ui/session";

import { saveLabFiles, type LabFileStore } from "./saveLabFiles";

function ref(fileName: string): TopologyRef {
  return {
    topologyId: `standalone:pages-sandbox::${fileName}`,
    labName: fileName.replace(/\.clab\.ya?ml$/i, ""),
    yamlPath: fileName,
    annotationsPath: `${fileName}.annotations.json`,
    source: "standalone",
  };
}

/** In-memory store; `failWrite` makes writes to that path throw. */
function memoryStore(initial: Record<string, string>, failWrite?: string) {
  const files = new Map(Object.entries(initial));
  const store: LabFileStore = {
    async findTopologyFile(fileName) {
      if (!files.has(fileName)) return undefined;
      return {
        topologyRef: ref(fileName),
        hasAnnotations: files.has(`${fileName}.annotations.json`),
      };
    },
    async createTopologyFile(fileName, content) {
      if (files.has(fileName)) throw new Error(`${fileName} already exists`);
      if (fileName === failWrite) throw new Error("quota exceeded");
      files.set(fileName, content);
      return ref(fileName);
    },
    async readFile(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    async writeFile(path, content) {
      if (path === failWrite) throw new Error("quota exceeded");
      files.set(path, content);
    },
    async deleteFile(path) {
      files.delete(path);
    },
  };
  return { files, store };
}

test("saveLabFiles creates a new lab with annotations", async () => {
  const { files, store } = memoryStore({});
  const result = await saveLabFiles(
    { fileName: "lab.clab.yml", yaml: "name: lab\n", annotations: "{}\n" },
    store,
  );
  assert.equal(result.replaced, false);
  assert.equal(result.topologyRef.yamlPath, "lab.clab.yml");
  assert.equal(files.get("lab.clab.yml"), "name: lab\n");
  assert.equal(files.get("lab.clab.yml.annotations.json"), "{}\n");
});

test("saveLabFiles overwrites an existing lab and drops old annotations for auto-layout", async () => {
  const { files, store } = memoryStore({
    "lab.clab.yml": "name: old\n",
    "lab.clab.yml.annotations.json": "{\"old\":true}\n",
  });
  const result = await saveLabFiles({ fileName: "lab.clab.yml", yaml: "name: lab\n" }, store);
  assert.equal(result.replaced, true);
  assert.equal(files.get("lab.clab.yml"), "name: lab\n");
  assert.equal(files.has("lab.clab.yml.annotations.json"), false);
});

test("saveLabFiles restores the old lab when writing annotations fails", async () => {
  const { files, store } = memoryStore(
    {
      "lab.clab.yml": "name: old\n",
      "lab.clab.yml.annotations.json": "{\"old\":true}\n",
    },
    "lab.clab.yml.annotations.json",
  );
  await assert.rejects(
    saveLabFiles(
      { fileName: "lab.clab.yml", yaml: "name: lab\n", annotations: "{}\n" },
      store,
    ),
    /quota exceeded/,
  );
  assert.equal(files.get("lab.clab.yml"), "name: old\n");
  assert.equal(files.get("lab.clab.yml.annotations.json"), "{\"old\":true}\n");
});

test("saveLabFiles restores the old lab when opening it fails", async () => {
  const { files, store } = memoryStore({
    "lab.clab.yml": "name: old\n",
    "lab.clab.yml.annotations.json": "{\"old\":true}\n",
  });
  await assert.rejects(
    saveLabFiles({ fileName: "lab.clab.yml", yaml: "name: lab\n" }, store, async () => {
      throw new Error("open failed");
    }),
    /open failed/,
  );
  assert.equal(files.get("lab.clab.yml"), "name: old\n");
  assert.equal(files.get("lab.clab.yml.annotations.json"), "{\"old\":true}\n");
});

test("saveLabFiles removes a new lab when a later step fails", async () => {
  const { files, store } = memoryStore({}, "lab.clab.yml.annotations.json");
  await assert.rejects(
    saveLabFiles(
      { fileName: "lab.clab.yml", yaml: "name: lab\n", annotations: "{}\n" },
      store,
    ),
    /quota exceeded/,
  );
  assert.equal(files.size, 0);
});

test("saveLabFiles leaves the old lab alone when the first write fails", async () => {
  const { files, store } = memoryStore({ "lab.clab.yml": "name: old\n" }, "lab.clab.yml");
  await assert.rejects(
    saveLabFiles({ fileName: "lab.clab.yml", yaml: "name: lab\n" }, store),
    /quota exceeded/,
  );
  assert.equal(files.get("lab.clab.yml"), "name: old\n");
});
