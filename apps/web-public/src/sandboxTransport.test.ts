import assert from "node:assert/strict";
import test from "node:test";
import { createMemorySandboxBackend } from "./sandboxBackend";
import { createSandboxTransport } from "./sandboxTransport";

// Edits through the shared host protocol are covered by topologyHostContract.test.ts.
test("sandbox transport leaves browser globals alone and disposes sessions", async () => {
  const backend = createMemorySandboxBackend();
  const originalFetch = globalThis.fetch;
  const transport = createSandboxTransport(backend);
  const session = backend.createSession(await backend.createTopologyFile("lab.clab.yml"));
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
