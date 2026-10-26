/* global describe, it, before, after, beforeEach */
/**
 * Tests for the node usage stream of the topology viewer: samples of the
 * deployed lab go to the webview, an older lab host says why there are none.
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

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("NodeStatsFeed", () => {
  let NodeStatsFeed: any;
  let backendStub: any;

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
      return originalResolve.call(this, request, parent, isMain, options);
    };
    backendStub = require("../../helpers/labBackends-stub");
    NodeStatsFeed =
      require("../../../src/reactTopoViewer/extension/services/NodeStatsFeed").NodeStatsFeed;
  });

  after(() => {
    (Module as any)._resolveFilename = originalResolve;
    clearModuleCache();
  });

  beforeEach(() => {
    backendStub.reset();
  });

  it("posts the samples of the deployed lab and clears them when it stops", async () => {
    const sample = { time: "2026-10-25T00:00:00Z", intervalSeconds: 2, nodes: [] };
    backendStub.setNodeStats({ supported: true, samples: [sample] });
    const posted: any[] = [];
    const feed = new NodeStatsFeed((message: unknown) => posted.push(message));

    feed.update({ yamlPath: "/labs/demo.clab.yml", labName: "demo" });
    await settle();
    expect(posted.map((message) => message.data)).to.deep.equal([{ clear: true }, { sample }]);
    expect(
      backendStub.calls.find((call: any) => call.method === "streamLabStats")?.args
    ).to.deep.equal(["demo"]);

    feed.update(undefined);
    expect(posted.at(-1)).to.deep.equal({ type: "node-stats-update", data: { clear: true } });
    feed.dispose();
  });

  it("says why there is no usage when the lab host cannot report it", async () => {
    backendStub.setNodeStats({ supported: false, samples: [] });
    const posted: any[] = [];
    const feed = new NodeStatsFeed((message: unknown) => posted.push(message));

    feed.update({ yamlPath: "/labs/demo.clab.yml", labName: "demo" });
    await settle();
    expect(posted.at(-1).data.unavailable).to.contain("Update clab-api-server");
    expect(backendStub.calls.some((call: any) => call.method === "streamLabStats")).to.equal(false);
    feed.dispose();
  });
});
