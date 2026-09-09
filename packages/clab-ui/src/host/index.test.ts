import assert from "node:assert/strict";
import test from "node:test";

import {
  createApiClabUiHost,
  createWindowClabUiHost,
  type ClabUiTopoViewerEvent
} from "./index";

type MessageHandler = (event: MessageEvent<unknown>) => void;

class FakeWindow {
  public vscode:
    | {
        postMessage: (message: unknown) => void;
        __isDevMock__?: boolean;
        __disableDevMockTraffic__?: boolean;
      }
    | undefined;
  public acquireVsCodeApi: (() => NonNullable<FakeWindow["vscode"]>) | undefined;
  private readonly listeners = new Set<MessageHandler>();

  addEventListener(_type: string, handler: EventListener): void {
    this.listeners.add(handler as MessageHandler);
  }

  removeEventListener(_type: string, handler: EventListener): void {
    this.listeners.delete(handler as MessageHandler);
  }

  dispatch(data: unknown): void {
    const event = { data } as MessageEvent<unknown>;
    for (const listener of Array.from(this.listeners)) {
      listener(event);
    }
  }
}

test("createWindowClabUiHost resolves VS Code API and posts semantic commands", () => {
  const messages: unknown[] = [];
  const targetWindow = new FakeWindow();
  targetWindow.acquireVsCodeApi = () => ({
    postMessage: (message: unknown) => {
      messages.push(message);
    }
  });

  const host = createWindowClabUiHost({ targetWindow: targetWindow as unknown as Window });

  host.explorer.connect();
  host.topoViewer.runLifecycle("restartLab");
  host.topoViewer.runNodeAction("ssh", "leaf1");
  host.topoViewer.runNodeAction("restart", "leaf1");

  assert.deepEqual(messages, [
    { command: "ready" },
    { command: "restartLab" },
    { command: "clab-node-connect-ssh", nodeName: "leaf1" },
    { command: "clab-node-restart", nodeName: "leaf1" }
  ]);
});

test("createWindowClabUiHost correlates snapshot requests with responses", async () => {
  const messages: Array<Record<string, unknown>> = [];
  const targetWindow = new FakeWindow();
  targetWindow.vscode = {
    postMessage: (message: unknown) => {
      messages.push(message as Record<string, unknown>);
    }
  };

  const host = createWindowClabUiHost({ targetWindow: targetWindow as unknown as Window });
  const snapshotPromise = host.topology.requestSnapshot({}, { externalChange: true });

  assert.equal(messages.length, 1);
  const requestId = messages[0]?.requestId;
  assert.equal(typeof requestId, "string");

  targetWindow.dispatch({
    type: "topology-host:snapshot",
    protocolVersion: 1,
    requestId,
    snapshot: {
      revision: 3,
      nodes: [],
      edges: [],
      annotations: {}
    }
  });

  const snapshot = await snapshotPromise;
  assert.equal(snapshot.revision, 3);
});

test("createWindowClabUiHost maps incoming topo viewer events", async () => {
  const targetWindow = new FakeWindow();
  targetWindow.vscode = {
    postMessage: () => {}
  };

  const host = createWindowClabUiHost({ targetWindow: targetWindow as unknown as Window });

  const eventPromise = new Promise<ClabUiTopoViewerEvent>((resolve) => {
    const unsubscribe = host.topoViewer.subscribe((event) => {
      unsubscribe();
      resolve(event);
    });
  });

  targetWindow.dispatch({
    type: "lab-lifecycle-status",
    data: { status: "success" }
  });

  const event = await eventPromise;
  assert.deepEqual(event, { type: "lifecycleStatus", status: "success" });
});

test("createApiClabUiHost posts topology requests to the standalone backend", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const targetWindow = new FakeWindow();
  const host = createApiClabUiHost({
    targetWindow: targetWindow as unknown as Window,
    postMessage: () => {},
    baseUrl: "http://localhost:3000/",
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? "{}"))
      });
      return new Response(
        JSON.stringify({
          snapshot: {
            revision: 7,
            nodes: [],
            edges: [],
            annotations: {}
          }
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
  });

  const snapshot = await host.topology.requestSnapshot({
    path: "labs/demo.clab.yml",
    sessionId: "session-1",
    mode: "edit",
    deploymentState: "undeployed"
  });

  assert.equal(snapshot.revision, 7);
  assert.deepEqual(requests, [
    {
      url: "http://localhost:3000/api/topology/snapshot?sessionId=session-1",
      body: {
        sessionId: "session-1",
        path: "labs/demo.clab.yml",
        mode: "edit",
        deploymentState: "undeployed",
        externalChange: false
      }
    }
  ]);
});
