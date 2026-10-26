/* global describe, it */
/**
 * Tests for the labs overview tab's cards: running labs of every connection
 * first by name, then topology files nobody deployed.
 */
import { expect } from "chai";

import {
  buildOverviewCards,
  type OverviewRunningLab,
  type OverviewTopologyFile
} from "../../../src/webviews/labsOverview/labsOverviewCards";

const LOCAL = { id: "local", label: "Local" };
const HOST = { id: "lab-host", label: "lab-host.example" };
const NOW = Date.parse("2026-10-26T12:00:00Z");

describe("buildOverviewCards", () => {
  it("summarizes a running lab: state, ready nodes and the oldest uptime", () => {
    const running: OverviewRunningLab[] = [
      {
        connection: LOCAL,
        labName: "fabric",
        path: "/labs/fabric.clab.yml",
        owner: "alice",
        containers: [
          { nodeName: "spine1", state: "running", status: "Up 2 hours" },
          { nodeName: "leaf1", state: "running", status: "Up 5 minutes (health: starting)" },
          { nodeName: "client1", state: "exited", status: "Exited (0) 1 minute ago" }
        ]
      }
    ];
    const [card] = buildOverviewCards(running, [], NOW);
    expect(card).to.deep.include({
      id: "local::/labs/fabric.clab.yml",
      endpointId: "local",
      name: "fabric",
      labName: "fabric",
      owner: "alice",
      state: "partial",
      nodeCount: 3,
      readyCount: 1,
      nodes: { spine1: "ready", leaf1: "starting", client1: "down" },
      startedAt: NOW - 2 * 3600_000,
      uptimePrecisionMs: 3600_000,
      canDeploy: false,
      canDestroy: true
    });
    // Its topology file opens from the card.
    expect(card.topologyRef).to.deep.include({
      yamlPath: "/labs/fabric.clab.yml",
      labName: "fabric"
    });
  });

  it("lists undeployed topology files after the running labs, without the running ones", () => {
    const running: OverviewRunningLab[] = [
      {
        connection: HOST,
        labName: "zeta",
        path: "clab-api://lab-host/zeta.clab.yml",
        containers: [{ nodeName: "r1", state: "running", status: "Up 1 minute" }]
      },
      // Another user's lab without a topology file here can only be looked at.
      { connection: HOST, labName: "theirs", containers: [] }
    ];
    const files: OverviewTopologyFile[] = [
      { connection: HOST, name: "zeta", path: "clab-api://lab-host/zeta.clab.yml" },
      { connection: LOCAL, name: "alpha", path: "/labs/alpha.clab.yml" }
    ];
    const cards = buildOverviewCards(running, files, NOW);
    expect(cards.map((card) => [card.id, card.state])).to.deep.equal([
      ["local::/labs/alpha.clab.yml", "undeployed"],
      ["lab-host::lab:theirs", "stopped"],
      ["lab-host::clab-api://lab-host/zeta.clab.yml", "running"]
    ]);
    expect(cards[0]).to.deep.include({ canDeploy: true, canDestroy: false, nodeCount: 0 });
    expect(cards[1]).to.deep.include({ canDestroy: false, topologyRef: undefined });
    expect(cards[0].topologyRef?.yamlPath).to.equal("/labs/alpha.clab.yml");
  });
});
