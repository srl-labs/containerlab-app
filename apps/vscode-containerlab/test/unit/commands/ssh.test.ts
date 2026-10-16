/* global describe, it, after, beforeEach, afterEach */
/**
 * Tests for the `sshToNode` command.
 *
 * The suite verifies that distributed Nokia SR SIM nodes SSH to the
 * base node hostname (without slot suffixes) while other node kinds
 * retain existing behavior, and that topology credentials pick the
 * login and identity file.
 */
import fs from "fs";
import Module from "module";
import os from "os";
import path from "path";

import { expect } from "chai";
import sinon from "sinon";

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

import { sshToNode } from "../../../src/commands/ssh";

const vscodeStub = require("../../helpers/vscode-stub");
const commandStub = require("../../helpers/command-stub");

describe("sshToNode command", () => {
  after(() => {
    (Module as any)._resolveFilename = originalResolve;
  });

  beforeEach(() => {
    commandStub.calls.length = 0;
    vscodeStub.window.lastErrorMessage = "";
    vscodeStub.workspace.getConfiguration = () => ({
      get: <T>(_: string, defaultValue?: T): T | undefined => defaultValue
    });
    sinon.spy(vscodeStub.window, "showErrorMessage");
  });

  afterEach(() => {
    sinon.restore();
  });

  it("uses base hostname for distributed nokia_srsim container nodes", () => {
    const node = {
      name: "clab-SRv6_lab-R1-a",
      name_short: "R1-a",
      rootNodeName: "R1",
      kind: "nokia_srsim",
      cID: "ctr-r1-a",
      v4Address: "",
      v6Address: ""
    } as any;

    sshToNode(node);

    expect(commandStub.calls).to.have.lengthOf(1);
    expect(commandStub.calls[0].command).to.equal("ssh admin@clab-SRv6_lab-R1");
    expect(commandStub.calls[0].terminalName).to.equal("SSH - clab-SRv6_lab-R1");
  });

  it("keeps direct container hostname for non-distributed nodes", () => {
    const node = {
      name: "clab-testlab-r2",
      name_short: "r2",
      kind: "nokia_srlinux",
      cID: "ctr-r2",
      v4Address: "",
      v6Address: ""
    } as any;

    sshToNode(node);

    expect(commandStub.calls).to.have.lengthOf(1);
    expect(commandStub.calls[0].command).to.equal("ssh admin@clab-testlab-r2");
    expect(commandStub.calls[0].terminalName).to.equal("SSH - clab-testlab-r2");
  });

  describe("with topology credentials", () => {
    let labDir: string;
    let topologyPath: string;

    beforeEach(() => {
      labDir = fs.mkdtempSync(path.join(os.tmpdir(), "clab-ssh-"));
      topologyPath = path.join(labDir, "lab.clab.yml");
      fs.writeFileSync(
        topologyPath,
        [
          "name: lab",
          "topology:",
          "  kinds:",
          "    nokia_srlinux:",
          "      credentials:",
          "        username: srl-admin",
          "  nodes:",
          "    r1:",
          "      kind: nokia_srlinux",
          "    r2:",
          "      kind: nokia_srlinux",
          "      credentials:",
          "        username: ops",
          "        identity-file: keys/r2 key",
          "    R1:",
          "      kind: nokia_srsim",
          "      credentials:",
          "        username: sim",
          ""
        ].join("\n")
      );
    });

    afterEach(() => {
      fs.rmSync(labDir, { recursive: true, force: true });
    });

    function containerNode(fields: Record<string, unknown>): any {
      return {
        cID: "ctr",
        v4Address: "",
        v6Address: "",
        labPath: { absolute: topologyPath, relative: "lab.clab.yml" },
        ...fields
      };
    }

    it("logs in with the inherited topology username", () => {
      sshToNode(containerNode({ name: "clab-lab-r1", name_short: "r1", kind: "nokia_srlinux" }));

      expect(commandStub.calls[0].command).to.equal("ssh srl-admin@clab-lab-r1");
    });

    it("passes the node identity file resolved from the topology folder", () => {
      sshToNode(containerNode({ name: "clab-lab-r2", name_short: "r2", kind: "nokia_srlinux" }));

      const keyPath = path.join(labDir, "keys", "r2 key");
      expect(commandStub.calls[0].command).to.equal(`ssh -i '${keyPath}' ops@clab-lab-r2`);
    });

    it("uses the root node credentials for distributed SR SIM containers", () => {
      sshToNode(
        containerNode({
          name: "clab-lab-R1-a",
          name_short: "R1-a",
          rootNodeName: "R1",
          kind: "nokia_srsim"
        })
      );

      expect(commandStub.calls[0].command).to.equal("ssh sim@clab-lab-R1");
    });
  });

  it("shows an error when no node is provided", () => {
    sshToNode(undefined);

    expect(commandStub.calls).to.have.lengthOf(0);
    const msgSpy = vscodeStub.window.showErrorMessage as sinon.SinonSpy;
    expect(msgSpy.calledOnceWith("No container node selected.")).to.be.true;
  });
});
