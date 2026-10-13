/* global describe, it, after, beforeEach */
/**
 * Tests for the `installEdgeshark` command.
 *
 * The suite verifies that the generated install command points packetflix at
 * the bare `gostwire` service name, which resolves on both Docker and Podman.
 */
import { execFileSync } from "child_process";
import Module from "module";
import path from "path";

import { expect } from "chai";

const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
  request: string,
  parent: any,
  isMain: boolean,
  options: any
) {
  if (request === "vscode") {
    return path.join(__dirname, "..", "..", "helpers", "vscode-stub.js");
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

const commandPath = require.resolve("../../../src/commands/command");
(require.cache as any)[commandPath] = {
  exports: require("../../helpers/command-stub.js")
} as any;

import { installEdgeshark } from "../../../src/commands/edgeshark";

const vscodeStub = require("../../helpers/vscode-stub");
const commandStub = require("../../helpers/command-stub");
const originalGetConfiguration = vscodeStub.workspace.getConfiguration;

const UPSTREAM_DISCOVERY_LINE = `        - "--discovery-service=gostwire.ghost-in-da-edge"\n`;

function useExtraEnvVars(value: string) {
  vscodeStub.workspace.getConfiguration = () => ({
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      key === "edgeshark.extraEnvironmentVars" ? (value as T) : defaultValue
  });
}

function applyDiscoveryRewrite(command: string): string {
  const match = /sed (?:-i )?'(s\/--discovery-service=[^']*)'/.exec(command);
  expect(match, `expected discovery rewrite in:\n${command}`).to.not.equal(null);
  return execFileSync("sed", [match![1]], { input: UPSTREAM_DISCOVERY_LINE, encoding: "utf8" });
}

describe("installEdgeshark command", () => {
  after(() => {
    (Module as any)._resolveFilename = originalResolve;
    vscodeStub.workspace.getConfiguration = originalGetConfiguration;
  });

  beforeEach(() => {
    commandStub.calls.length = 0;
  });

  it("rewrites the discovery service to the bare gostwire name", async () => {
    useExtraEnvVars("");

    await installEdgeshark();

    expect(commandStub.calls).to.have.lengthOf(1);
    expect(applyDiscoveryRewrite(commandStub.calls[0].command)).to.equal(
      `        - "--discovery-service=gostwire"\n`
    );
  });

  it("rewrites the discovery service when extra environment variables are set", async () => {
    useExtraEnvVars("HTTP_PROXY=, http_proxy=");

    await installEdgeshark();

    expect(commandStub.calls).to.have.lengthOf(1);
    expect(commandStub.calls[0].command).to.contain("mktemp -t edgeshark-compose");
    expect(applyDiscoveryRewrite(commandStub.calls[0].command)).to.equal(
      `        - "--discovery-service=gostwire"\n`
    );
  });
});
