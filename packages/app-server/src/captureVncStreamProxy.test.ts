import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import fastifyWebsocket from "@fastify/websocket";
import type { LabBackend, WiresharkVncSocket } from "@srl-labs/containerlab-lab-backend";
import Fastify from "fastify";
import WebSocket from "ws";

import { createStandaloneApp } from "./app";
import { deleteCaptureSessionEndpoint, getCaptureSessionEndpoint } from "./captureSessionStore";
import { registerCaptureVncStreamProxy } from "./captureVncStreamProxy";
import type { ResolvedEndpoint } from "./endpointResolver";
import { createLocalUiStore } from "./localUiStore";

/** A lab host whose Wireshark VNC sessions answer every viewer, and that records closes. */
function fakeVncBackend(closed: string[]): LabBackend {
  return {
    connectWiresharkVnc(): WiresharkVncSocket {
      let opened: (() => void) | undefined;
      setImmediate(() => opened?.());
      return {
        send() {},
        onOpen(listener) {
          opened = listener;
        },
        onMessage() {},
        onClose() {},
        onError() {},
        close() {}
      };
    },
    async closeWiresharkVnc(sessionId: string) {
      closed.push(sessionId);
    }
  } as unknown as LabBackend;
}

async function startProxy(t: TestContext, viewerGraceMs: number) {
  const closed: string[] = [];
  const resolved = {
    backend: fakeVncBackend(closed),
    endpoint: { id: "endpoint-1" }
  } as unknown as ResolvedEndpoint;
  const app = Fastify();
  await app.register(fastifyWebsocket);
  registerCaptureVncStreamProxy(app, () => resolved, { viewerGraceMs });
  await app.listen({ port: 0, host: "127.0.0.1" });
  t.after(() => app.close());
  const { port } = app.server.address() as AddressInfo;
  const viewer = async (sessionId: string) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:${port}/api/runtime/capture/wireshark-vnc-sessions/${sessionId}/vnc/websockify`
    );
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return socket;
  };
  return { closed, viewer };
}

const until = async (check: () => boolean, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
};

test("a Wireshark VNC session ends once its last viewer is gone for the grace period", async (t) => {
  // The window closes its sessions as it goes away, but a browser that quits right after,
  // or crashes, may not send that request: the viewers' connections still end.
  const { closed, viewer } = await startProxy(t, 100);
  const first = await viewer("session-a");
  const second = await viewer("session-b");

  first.close();
  second.close();
  await until(() => closed.length === 2);
  assert.deepEqual([...closed].sort(), ["session-a", "session-b"]);
  assert.equal(getCaptureSessionEndpoint("session-a"), undefined);
});

test("a viewer that reconnects within the grace period keeps its Wireshark VNC session", async (t) => {
  const { closed, viewer } = await startProxy(t, 200);
  (await viewer("session-c")).close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const again = await viewer("session-c");
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(closed, []);

  again.close();
  await until(() => closed.length === 1);
  assert.deepEqual(closed, ["session-c"]);
});

test("a Wireshark VNC session its window closed is not closed again", async (t) => {
  const { closed, viewer } = await startProxy(t, 100);
  const socket = await viewer("session-d");
  // The window's close request forgets the session's lab host.
  deleteCaptureSessionEndpoint("session-d");
  socket.close();
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(closed, []);
});

test("a Wireshark window closes all of its sessions with one request", async (t) => {
  const closed: string[] = [];
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vnc-close-"));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const app = await createStandaloneApp({
    isDev: true,
    logger: false,
    viteDevUrl: "http://vite.test",
    localEndpoint: {
      backend: fakeVncBackend(closed),
      ui: createLocalUiStore({ clabDirectory: workspaceRoot, workspaceRoot }),
      status: async () => ({ available: true, problems: [], label: "This computer", username: "alice" })
    }
  });
  t.after(() => app.close());
  const added = await app.inject({ method: "POST", url: "/auth/endpoints/add", payload: { kind: "local" } });
  const header = added.headers["set-cookie"];
  const cookie = (Array.isArray(header) ? header[0] : header ?? "").split(";")[0];
  const endpointId = added.json<{ id: string }>().id;

  const response = await app.inject({
    method: "POST",
    url: `/api/runtime/capture/wireshark-vnc-sessions/close?sessionId=session-e&sessionId=session-f&endpointId=${endpointId}`,
    headers: { cookie }
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { closed: ["session-e", "session-f"], failed: [] });
  assert.deepEqual(closed, ["session-e", "session-f"]);

  const empty = await app.inject({
    method: "POST",
    url: "/api/runtime/capture/wireshark-vnc-sessions/close",
    headers: { cookie }
  });
  assert.equal(empty.statusCode, 400);
});
