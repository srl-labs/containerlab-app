/* global describe, it, before, after, beforeEach */
/**
 * Tests for the Fabric view's tab: the webview's requests and event streams
 * reach the lab backend, and the answers come back under the same id.
 */
import Module from "module";
import path from "path";

import { expect } from "chai";

const originalResolve = (Module as any)._resolveFilename;

function clearModuleCache() {
  Object.keys(require.cache).forEach((key) => {
    if (key.includes("vscode-containerlab") && !key.includes("node_modules")) {
      delete require.cache[key];
    }
  });
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("Fabric view", () => {
  let openFabricView: any;
  let vscodeStub: any;
  let backendCalls: any[];
  let posted: any[];
  let onMessage: (message: unknown) => void;
  let onDispose: () => void;
  let createdPanels: number;
  let revealed: number;
  let answer: (request: any) => { status: number; body: unknown };
  let eventsFailure: Error | undefined;
  let streamSignal: AbortSignal | undefined;
  let streamStaysOpen: boolean;
  let supported: boolean;

  const backend = {
    async fclingEngine(target: unknown) {
      backendCalls.push(["fclingEngine", target]);
      return { state: "ready" };
    },
    async startFclingEngine(target: unknown) {
      backendCalls.push(["startFclingEngine", target]);
      return { state: "starting" };
    },
    async stopFclingEngine(target: unknown) {
      backendCalls.push(["stopFclingEngine", target]);
    },
    async fclingApi(target: unknown, request: unknown) {
      backendCalls.push(["fclingApi", target, request]);
      return answer(request);
    },
    async streamFclingEvents(target: unknown, options: { after?: number; signal: AbortSignal }) {
      backendCalls.push(["streamFclingEvents", target, options.after]);
      streamSignal = options.signal;
      if (eventsFailure) throw eventsFailure;
      return (async function* () {
        yield { type: "status", nodes: [] };
        if (streamStaysOpen) {
          await new Promise((resolve) => options.signal.addEventListener("abort", resolve));
          return;
        }
        yield { type: "change", seq: 4 };
      })();
    }
  };

  const node = {
    name: "lab1",
    label: "lab1",
    connectionId: "api-1",
    labPath: { absolute: "/labs/lab1.clab.yml", relative: "lab1.clab.yml" }
  };

  before(() => {
    clearModuleCache();
    (Module as any)._resolveFilename = function (
      request: string,
      parent: any,
      isMain: boolean,
      options: any
    ) {
      if (request === "vscode") {
        return path.join(__dirname, "..", "..", "helpers", "vscode-stub.js");
      }
      if (request.endsWith("/backend/labBackends")) {
        return path.join(__dirname, "..", "..", "helpers", "labBackends-stub.js");
      }
      if (request.endsWith("/backend/labHostSupport")) {
        return request;
      }
      return originalResolve.call(this, request, parent, isMain, options);
    };
    require.cache["../backend/labHostSupport"] = {
      id: "../backend/labHostSupport",
      filename: "../backend/labHostSupport",
      loaded: true,
      exports: { ensureHostSupports: async () => supported }
    } as any;
    vscodeStub = require("../../helpers/vscode-stub");
    const backendStub = require("../../helpers/labBackends-stub");
    backendStub.connectionOf = () => ({ id: "api-1" });
    backendStub.resolveLab = async () => ({
      backend,
      target: { labName: "lab1", path: "/labs/lab1.clab.yml" }
    });
    vscodeStub.extensions = {
      getExtension: () => ({ extensionUri: vscodeStub.Uri.file("/extension") })
    };
    vscodeStub.ViewColumn = vscodeStub.ViewColumn ?? { Active: -1 };
    openFabricView = require("../../../src/commands/fabric").openFabricView;
  });

  after(() => {
    (Module as any)._resolveFilename = originalResolve;
    delete require.cache["../backend/labHostSupport"];
  });

  beforeEach(() => {
    backendCalls = [];
    posted = [];
    createdPanels = 0;
    revealed = 0;
    supported = true;
    eventsFailure = undefined;
    streamSignal = undefined;
    streamStaysOpen = false;
    answer = () => ({ status: 200, body: { rows: [] } });
    vscodeStub.window.createWebviewPanel = () => {
      createdPanels += 1;
      return {
        iconPath: undefined,
        reveal: () => {
          revealed += 1;
        },
        onDidDispose: (listener: () => void) => {
          onDispose = listener;
        },
        webview: {
          html: "",
          cspSource: "vscode-webview:",
          asWebviewUri: (uri: unknown) => uri,
          postMessage: async (message: unknown) => {
            posted.push(message);
          },
          onDidReceiveMessage: (listener: (message: unknown) => void) => {
            onMessage = listener;
          }
        }
      };
    };
  });

  /** Opens the view; each test closes it, so the next opens a new tab. */
  async function open() {
    await openFabricView(node);
    return () => onDispose();
  }

  it("does not open on a lab host without fcling", async () => {
    supported = false;
    await openFabricView(node);
    expect(createdPanels).to.equal(0);
  });

  it("opens one tab per lab, and reveals it when asked again", async () => {
    const close = await open();
    await openFabricView(node);
    expect(createdPanels).to.equal(1);
    expect(revealed).to.equal(1);
    close();
    await openFabricView(node);
    expect(createdPanels).to.equal(2);
    onDispose();
  });

  it("names a lab on this machine, which resolves to its topology file only", async () => {
    const backendStub = require("../../helpers/labBackends-stub");
    const resolveLab = backendStub.resolveLab;
    backendStub.resolveLab = async () => ({
      backend,
      target: { labName: "", path: "/labs/lab1.clab.yml" }
    });
    let title = "";
    const createPanel = vscodeStub.window.createWebviewPanel;
    vscodeStub.window.createWebviewPanel = (...args: unknown[]) => {
      title = String(args[1]);
      return createPanel(...args);
    };
    const close = await open();
    backendStub.resolveLab = resolveLab;
    onMessage({ type: "fabric:request", requestId: 1, op: "engine-status" });
    await tick();
    expect(title).to.equal("Fabric: lab1");
    expect(backendCalls[0][1]).to.deep.equal({ labName: "lab1", path: "/labs/lab1.clab.yml" });
    close();
  });

  it("answers an engine request under its id", async () => {
    const close = await open();
    onMessage({ type: "fabric:request", requestId: 7, op: "engine-start" });
    await tick();
    expect(backendCalls[0][0]).to.equal("startFclingEngine");
    expect(backendCalls[0][1].labName).to.equal("lab1");
    expect(posted).to.deep.equal([{ type: "fabric:response", requestId: 7, result: { state: "starting" } }]);
    close();
  });

  it("passes an API call on, and turns the engine's error status into an error", async () => {
    const close = await open();
    const request = { method: "GET", path: "reports/bgp-peers", query: { table: "1" } };
    onMessage({ type: "fabric:request", requestId: 1, op: "api", request });
    await tick();
    expect(backendCalls[0][2]).to.deep.equal(request);
    expect(posted[0]).to.deep.equal({ type: "fabric:response", requestId: 1, result: { rows: [] } });

    answer = () => ({ status: 404, body: { error: "no such report" } });
    onMessage({ type: "fabric:request", requestId: 2, op: "api", request });
    await tick();
    expect(posted[1]).to.deep.equal({
      type: "fabric:response",
      requestId: 2,
      error: "no such report",
      status: 404
    });
    close();
  });

  it("carries the status of a backend that refuses", async () => {
    const close = await open();
    const refusal = Object.assign(new Error("not running"), { status: 409 });
    const original = backend.fclingEngine;
    backend.fclingEngine = async () => {
      throw refusal;
    };
    onMessage({ type: "fabric:request", requestId: 3, op: "engine-status" });
    await tick();
    backend.fclingEngine = original;
    expect(posted[0]).to.deep.equal({
      type: "fabric:response",
      requestId: 3,
      error: "not running",
      status: 409
    });
    close();
  });

  it("follows the event stream from where the view left off, to its end", async () => {
    const close = await open();
    onMessage({ type: "fabric:events-start", streamId: 5, after: 3 });
    await tick();
    await tick();
    expect(backendCalls[0][2]).to.equal(3);
    expect(posted).to.deep.equal([
      { type: "fabric:events-open", streamId: 5 },
      { type: "fabric:event", streamId: 5, event: { type: "status", nodes: [] } },
      { type: "fabric:event", streamId: 5, event: { type: "change", seq: 4 } },
      { type: "fabric:events-end", streamId: 5 }
    ]);
    close();
  });

  it("says why a stream ended", async () => {
    const close = await open();
    eventsFailure = new Error("engine stopped");
    onMessage({ type: "fabric:events-start", streamId: 6 });
    await tick();
    expect(posted).to.deep.equal([{ type: "fabric:events-end", streamId: 6, error: "engine stopped" }]);
    close();
  });

  it("closing the tab ends its streams and leaves the engine running", async () => {
    const close = await open();
    streamStaysOpen = true;
    onMessage({ type: "fabric:events-start", streamId: 8 });
    await tick();
    close();
    expect(streamSignal?.aborted).to.equal(true);
    expect(backendCalls.some(([method]) => method === "stopFclingEngine")).to.equal(false);
  });
});
