import assert from "node:assert/strict";
import test from "node:test";

import { createMemorySandboxBackend } from "./sandboxBackend";

test("sandbox backend creates and lists topology files", async () => {
  const backend = createMemorySandboxBackend();
  const topologyRef = await backend.createTopologyFile("demo.clab.yml");

  assert.equal(topologyRef.yamlPath, "demo.clab.yml");
  assert.equal(topologyRef.labName, "demo");
  assert.deepEqual(
    backend.listTopologyFiles().map((entry) => entry.path),
    ["demo.clab.yml"],
  );
});

test("sandbox backend topology session snapshots created yaml", async () => {
  const backend = createMemorySandboxBackend();
  await backend.createTopologyFile("lab.clab.yml", "name: lab\ntopology:\n  nodes: {}\n");
  const session = backend.createSession({
    topologyId: "pages-sandbox::lab.clab.yml",
    labName: "lab",
    yamlPath: "lab.clab.yml",
    annotationsPath: "lab.clab.yml.annotations.json",
    source: "standalone",
  });

  const snapshot = await backend.getSnapshot(session.sessionId);
  assert.equal(snapshot.labName, "lab");
  assert.equal(snapshot.mode, "edit");
  assert.equal(snapshot.deploymentState, "undeployed");
  assert.match(snapshot.yamlContent, /name:\s*lab/);

  backend.disposeSession(session.sessionId);
  await assert.rejects(
    () => backend.getSnapshot(session.sessionId),
    /Topology session not found/,
  );
});

test("sandbox backend file explorer writes and reads files", async () => {
  const backend = createMemorySandboxBackend();
  await backend.writeFile("notes/readme.txt", "hello");
  const document = await backend.readFile("notes/readme.txt");
  assert.equal(document.content, "hello");

  const root = backend.listDirectory("");
  assert.equal(root.some((entry) => entry.kind === "directory" && entry.name === "notes"), true);
});

test("file edits refresh an open session while ordinary snapshots preserve undo", async () => {
  const backend = createMemorySandboxBackend();
  const topologyRef = await backend.createTopologyFile("lab.clab.yml");
  const { sessionId } = backend.createSession(topologyRef);
  const before = await backend.getSnapshot(sessionId);
  await backend.dispatchCommand(sessionId, before.revision, {
    command: "setYamlContent", payload: { content: "name: edited\ntopology:\n  nodes: {}\n" }
  });
  const edited = await backend.getSnapshot(sessionId);
  assert.equal(edited.canUndo, true);
  assert.equal((await backend.getSnapshot(sessionId)).revision, edited.revision);
  await backend.writeFile("notes.txt", "unrelated file");
  assert.equal((await backend.getSnapshot(sessionId)).canUndo, true);
  await backend.writeFile("lab.clab.yml", "name: external\ntopology:\n  nodes: {}\n");
  const external = await backend.getSnapshot(sessionId);
  assert.equal(external.labName, "external");
  assert.equal(external.canUndo, false);
  assert.ok(external.revision > edited.revision);
});
