import assert from "node:assert/strict";
import test from "node:test";
import { createApiClabUiHost } from "@containerlab/clab-ui/host";
import { createMemorySandboxBackend } from "./sandboxBackend";
import { createSandboxTransport } from "./sandboxTransport";

// Exercise the actual shared host protocol against the local adapter, including a deployment prefix.
test("shared topology host edits and persists a sandbox document", async () => {
  const backend = createMemorySandboxBackend();
  const transport = createSandboxTransport(backend);
  const originalFetch = globalThis.fetch;
  const topologyRef = await backend.createTopologyFile("lab.clab.yml");
  const session = backend.createSession(topologyRef);
  const host = createApiClabUiHost({
    baseUrl: "http://localhost/sandbox/",
    fetchImpl: transport.fetch,
    postMessage: () => {},
    targetWindow: new EventTarget() as unknown as Window
  });
  const before = await host.topology.requestSnapshot(session, {});
  const content = "name: edited\ntopology:\n  nodes:\n    router:\n      kind: linux\n      image: alpine:latest\n";
  const response = await host.topology.dispatchCommand(session, before.revision, {
    command: "setYamlContent", payload: { content }
  });
  assert.notEqual(response.type, "topology-host:error");
  const after = await host.topology.requestSnapshot(session, {});
  assert.equal(after.labName, "edited");
  assert.equal(after.nodes[0]?.id, "router");
  assert.equal((await backend.readFile("lab.clab.yml")).content, content);
  assert.equal(globalThis.fetch, originalFetch, "the adapter must never replace browser globals");
  const deleted = await transport.fetch(`http://localhost/sandbox/api/topology/sessions/${session.sessionId}`, { method: "DELETE" });
  assert.equal(deleted.status, 200);
  await assert.rejects(() => backend.getSnapshot(session.sessionId), /session not found/);
});

test("sandbox transport supports file save, upload, rename and download", async () => {
  const backend = createMemorySandboxBackend();
  const { fetch } = createSandboxTransport(backend);
  const call = (path: string, method: string, body: unknown) => fetch(`http://localhost/sandbox/api/runtime/file-explorer/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await call("file", "PUT", { path: "notes.txt", content: "first" })).status, 200);
  assert.equal((await call("file/rename", "POST", { oldPath: "notes.txt", newPath: "docs/notes.txt" })).status, 200);
  const form = new FormData();
  form.set("path", "docs");
  form.append("files", new File(["uploaded"], "readme.txt"));
  assert.equal((await fetch("http://localhost/sandbox/api/runtime/file-explorer/upload", { method: "POST", body: form })).status, 200);
  const downloaded = await fetch("http://localhost/sandbox/api/runtime/file-explorer/download?path=docs%2Freadme.txt");
  assert.equal(await downloaded.text(), "uploaded");
  assert.match(downloaded.headers.get("Content-Disposition") ?? "", /readme.txt/);
  assert.equal((await backend.readFile("docs/notes.txt")).content, "first");
  assert.equal((await fetch("http://localhost/api/runtime/deploy", { method: "POST" })).status, 501);
  assert.equal((await fetch("http://localhost/api/runtime/file-explorer/file?path=missing.txt")).status, 400);
});
