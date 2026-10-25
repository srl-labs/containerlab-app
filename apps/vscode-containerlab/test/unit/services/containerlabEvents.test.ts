/* global describe, it, after, beforeEach */
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

import {
  estimateStartedAtFromStatusForTests,
  eventStreamFor,
  handleEventLineForTests,
  resetForTests
} from "../../../src/services/containerlabEvents";

/** Events of Local, as the extension streams them for this machine. */
function getInterfaceSnapshot(containerShortId: string, containerName: string) {
  return eventStreamFor("local").getInterfaceSnapshot(containerShortId, containerName);
}

describe("containerlabEvents uptime parsing", () => {
  beforeEach(() => {
    resetForTests();
  });

  after(() => {
    (Module as any)._resolveFilename = originalResolve;
  });

  it("parses week-based uptime from docker status", () => {
    const eventTimestamp = Date.parse("2026-02-25T12:00:00.000Z");
    const parsed = estimateStartedAtFromStatusForTests("Up 2 weeks", eventTimestamp);

    expect(parsed).to.equal(eventTimestamp - 14 * 24 * 60 * 60 * 1000);
  });

  it("parses week-based uptime with health suffix", () => {
    const eventTimestamp = Date.parse("2026-02-25T12:00:00.000Z");
    const parsed = estimateStartedAtFromStatusForTests("Up 2 weeks (healthy)", eventTimestamp);

    expect(parsed).to.equal(eventTimestamp - 14 * 24 * 60 * 60 * 1000);
  });

  it("preserves netem state when later interface events omit netem attributes", () => {
    handleEventLineForTests(
      JSON.stringify({
        type: "interface",
        action: "create",
        actor_id: "container-1",
        attributes: {
          ifname: "eth1",
          type: "veth",
          state: "up",
          netem_delay: "25ms",
          netem_jitter: "5ms"
        }
      })
    );

    handleEventLineForTests(
      JSON.stringify({
        type: "interface",
        action: "stats",
        actor_id: "container-1",
        attributes: {
          ifname: "eth1",
          rx_bps: 1000,
          tx_bps: 2000
        }
      })
    );

    const snapshot = getInterfaceSnapshot("container-1", "clab-demo-srl1");
    const iface = snapshot[0]?.interfaces.find((entry) => entry.name === "eth1");

    expect(iface?.netemDelay).to.equal("25ms");
    expect(iface?.netemJitter).to.equal("5ms");
    expect(iface?.rxBps).to.equal(1000);
    expect(iface?.txBps).to.equal(2000);
  });

  it("defaults new interfaces without netem state and honors explicit reset values", () => {
    handleEventLineForTests(
      JSON.stringify({
        type: "interface",
        action: "create",
        actor_id: "container-2",
        attributes: {
          ifname: "eth2",
          type: "veth",
          state: "up"
        }
      })
    );

    let snapshot = getInterfaceSnapshot("container-2", "clab-demo-srl2");
    let iface = snapshot[0]?.interfaces.find((entry) => entry.name === "eth2");

    expect(iface?.netemDelay).to.equal("0ms");
    expect(iface?.netemJitter).to.equal("0ms");

    handleEventLineForTests(
      JSON.stringify({
        type: "interface",
        action: "update",
        actor_id: "container-2",
        attributes: {
          ifname: "eth2",
          netem_delay: "30ms"
        }
      })
    );
    handleEventLineForTests(
      JSON.stringify({
        type: "interface",
        action: "update",
        actor_id: "container-2",
        attributes: {
          ifname: "eth2",
          netem_delay: "0ms"
        }
      })
    );

    snapshot = getInterfaceSnapshot("container-2", "clab-demo-srl2");
    iface = snapshot[0]?.interfaces.find((entry) => entry.name === "eth2");

    expect(iface?.netemDelay).to.equal("0ms");
  });
});

describe("containerlabEvents per connection", () => {
  beforeEach(() => {
    resetForTests();
  });

  it("keeps the labs of each connection apart", () => {
    const container = (id: string, lab: string) =>
      JSON.stringify({
        type: "container",
        action: "start",
        actor_id: id,
        actor_name: `clab-${lab}-n1`,
        attributes: { containerlab: lab, "clab-node-name": "n1", state: "running" }
      });
    handleEventLineForTests(container("aaaaaaaaaaaa", "local-lab"), "local");
    handleEventLineForTests(container("bbbbbbbbbbbb", "remote-lab"), "api-1");

    expect(Object.keys(eventStreamFor("local").getGroupedContainers())).to.deep.equal([
      "local-lab"
    ]);
    expect(Object.keys(eventStreamFor("api-1").getGroupedContainers())).to.deep.equal([
      "remote-lab"
    ]);
  });

  describe("published ports", () => {
    const containerEvent = (action: string, attributes: Record<string, unknown>) =>
      JSON.stringify({
        type: "container",
        action,
        actor_id: "cccccccccccc",
        actor_name: "clab-ports-n1",
        attributes: { containerlab: "ports", "clab-node-name": "n1", ...attributes }
      });
    const ports = () => eventStreamFor("local").getGroupedContainers().ports?.[0]?.Ports;

    it("lists the host ports of the ports attribute once per port and protocol", () => {
      handleEventLineForTests(
        containerEvent("start", {
          state: "running",
          ports: "0.0.0.0:8080/tcp->80;[::]:8080/tcp->80;0.0.0.0:5353/udp->53;443/tcp;127.0.0.1:9000"
        })
      );

      expect(ports()).to.deep.equal([
        { port: 8080, protocol: "tcp" },
        { port: 5353, protocol: "udp" },
        { port: 9000, protocol: "tcp" }
      ]);
    });

    it("keeps the ports of a running container and drops them once it stops", () => {
      handleEventLineForTests(
        containerEvent("start", { state: "running", ports: "0.0.0.0:8080/tcp->80" })
      );
      handleEventLineForTests(containerEvent("health_status: healthy", { state: "running" }));
      expect(ports()).to.deep.equal([{ port: 8080, protocol: "tcp" }]);

      handleEventLineForTests(containerEvent("die", { state: "exited" }));
      expect(ports()).to.deep.equal([]);
    });
  });
});
