import assert from "node:assert/strict";
import test from "node:test";

import { collectConnectionIssues } from "./connectionIssues";
import { labDeepLinkUrl, parseLabDeepLink, withLabDeepLink } from "./labDeepLink";
import { explorerPreferences } from "./standaloneExplorerActions";
import { buildLabOverviewCards, type UptimeEstimates } from "./standaloneLabsOverview";
import type { TopologyFileEntry } from "./standaloneHostShared";
import type { EndpointConfig } from "./stores/endpointStore";
import type { EventStreamState } from "./stores/eventStreamStore";
import type { ContainerState, LabState } from "./stores/labStore";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function endpoint(id: string, label: string, status: EndpointConfig["status"] = "connected"): EndpointConfig {
  return {
    id, label, url: `https://${id}.test`, username: "alice", sessionDuration: "24h", status, connected: status === "connected"
  };
}

function topologyFile(endpointId: string, path: string, labName: string, hasAnnotations = false): TopologyFileEntry {
  return {
    endpointId,
    filename: path.split("/").at(-1) ?? path,
    path,
    hasAnnotations,
    labName,
    deploymentState: "undeployed",
    topologyRef: {
      topologyId: `standalone:${endpointId}::${path}`,
      labName,
      yamlPath: path,
      annotationsPath: `${path}.annotations.json`,
      source: "standalone"
    }
  };
}

function container(endpointId: string, labName: string, nodeName: string, state: string, status: string, owner = "alice"): ContainerState {
  return {
    endpointId, name: `clab-${labName}-${nodeName}`, containerId: nodeName, labName, labPath: `${labName}/${labName}.clab.yml`,
    owner, nodeName, kind: "linux", image: "alpine", state, status, ipv4Address: "", ipv6Address: "", interfaces: new Map()
  };
}

function lab(endpointId: string, name: string, containers: ContainerState[], owner = "alice"): LabState {
  return {
    endpointId, name, owner, topologyPath: `${name}/${name}.clab.yml`,
    containers: new Map(containers.map((entry) => [entry.name, entry]))
  };
}

test("overview cards list running labs with readiness and uptime, then undeployed files", () => {
  const endpoints = [endpoint("a", "Server A"), endpoint("b", "Server B", "offline")];
  const labs = new Map([
    ["a:srl", lab("a", "srl", [
      container("a", "srl", "leaf1", "running", "Up 2 hours (healthy)"),
      container("a", "srl", "leaf2", "running", "Up 16 minutes (health: starting)"),
      container("a", "srl", "client", "exited", "Exited (1) 3 minutes ago")
    ])],
    ["b:gone", lab("b", "gone", [container("b", "gone", "n1", "running", "Up 1 minute")])]
  ]);
  const files = [
    topologyFile("a", "srl/srl.clab.yml", "srl", true),
    topologyFile("a", "@shared/team/team.clab.yml", "team"),
    topologyFile("a", ".hidden.clab.yml", "hidden"),
    topologyFile("b", "other/other.clab.yml", "other")
  ];
  const uptimes: UptimeEstimates = new Map();
  const cards = buildLabOverviewCards({
    labs, files, endpoints, lifecycle: true, now: 10 * HOUR, uptimes,
    linkFor: (endpointId, path) => `link:${endpointId}::${path}`
  });

  assert.deepEqual(cards.map((card) => [card.name, card.state]), [["srl", "partial"], ["team", "undeployed"]]);
  const [running, undeployed] = cards;
  assert.equal(running.id, "a::srl/srl.clab.yml");
  assert.equal(running.annotationsPath, "srl/srl.clab.yml.annotations.json");
  assert.equal(running.nodeCount, 3);
  assert.equal(running.readyCount, 1);
  assert.deepEqual(running.nodes, { leaf1: "ready", leaf2: "starting", client: "down" });
  assert.equal(running.startedAt, 8 * HOUR);
  assert.equal(running.uptimePrecisionMs, HOUR);
  assert.equal(running.owner, "alice");
  assert.equal(running.canDestroy, true);
  assert.equal(running.canDeploy, false);
  assert.equal(running.link, "link:a::srl/srl.clab.yml");

  assert.equal(undeployed.shared, true);
  assert.equal(undeployed.owner, undefined, "files are ours or shared, so they name no owner");
  assert.equal(undeployed.canDeploy, true);
  assert.equal(undeployed.annotationsPath, undefined);
});

test("uptime estimates keep advancing between builds and keep their finer precision", () => {
  const endpoints = [endpoint("a", "Server A")];
  const uptimes: UptimeEstimates = new Map();
  const build = (status: string, now: number) => buildLabOverviewCards({
    labs: new Map([["a:l", lab("a", "l", [container("a", "l", "n1", "running", status)])]]),
    files: [], endpoints, lifecycle: true, now, uptimes
  })[0];

  assert.equal(build("Up 59 minutes", 0).startedAt, -59 * MINUTE);
  // Docker rounds to "About an hour" a little later; the start estimate stays minute-precise.
  const later = build("Up About an hour", 2 * MINUTE);
  assert.equal(later.startedAt, -59 * MINUTE);
  assert.equal(later.uptimePrecisionMs, MINUTE);
  // A restart starts over.
  assert.equal(build("Up 3 seconds", 3 * MINUTE).startedAt, 3 * MINUTE - 3000);
  buildLabOverviewCards({ labs: new Map(), files: [], endpoints, lifecycle: true, now: 0, uptimes });
  assert.equal(uptimes.size, 0, "estimates of removed containers are dropped");
});

test("another user's lab is listed without our file, and the sandbox cannot deploy", () => {
  const endpoints = [endpoint("a", "Server A")];
  const labs = new Map([["a:demo", lab("a", "demo", [container("a", "demo", "n1", "running", "Up 1 minute", "bob")], "bob")]]);
  const files = [topologyFile("a", "demo/demo.clab.yml", "demo"), topologyFile("a", "lab.clab.yml", "lab")];
  const build = () => buildLabOverviewCards({ labs, files, endpoints, lifecycle: false, now: 0, uptimes: new Map() });
  const original = explorerPreferences.showNonOwnedLabs;
  try {
    // As in the explorer, other users' labs follow the "show non-owned labs" choice.
    explorerPreferences.showNonOwnedLabs = false;
    assert.deepEqual(build().map((card) => card.name), ["lab"]);
    assert.equal(build()[0].canDeploy, false);

    explorerPreferences.showNonOwnedLabs = true;
    const demo = build().find((card) => card.name === "demo");
    assert.equal(demo?.owner, "bob");
    assert.equal(demo?.path, undefined, "never our same-named file");
    assert.equal(demo?.id, "a::lab:demo");
    assert.equal(demo?.topologyRef?.yamlPath, "demo/demo.clab.yml");
    assert.equal(demo?.link, undefined);
    assert.equal(demo?.canDestroy, false, "nothing runs without lab lifecycle");
  } finally {
    explorerPreferences.showNonOwnedLabs = original;
  }
});

test("connection issues report the API and live events separately", () => {
  const endpoints = [
    endpoint("ok", "Fine"),
    endpoint("down", "Down", "offline"),
    endpoint("expired", "Expired", "session_expired"),
    endpoint("signed-out", "Signed out", "saved"),
    endpoint("flaky", "Flaky"),
    endpoint("starting", "Starting")
  ];
  const streams = new Map<string, EventStreamState>([
    ["ok", { state: "connected", failures: 0 }],
    ["down", { state: "reconnecting", failures: 2, retryAt: 5000 }],
    ["expired", { state: "paused", failures: 0 }],
    ["flaky", { state: "reconnecting", failures: 1, retryAt: 2000, error: "stream ended" }],
    ["starting", { state: "connecting", failures: 0 }]
  ]);
  assert.deepEqual(collectConnectionIssues(endpoints, streams, true), [
    { endpointId: "down", label: "Down", api: "unreachable", events: { state: "reconnecting", retryAt: 5000 } },
    { endpointId: "expired", label: "Expired", api: "session_expired", events: { state: "paused" } },
    { endpointId: "flaky", label: "Flaky", api: "reachable", events: { state: "reconnecting", retryAt: 2000, error: "stream ended" } }
  ]);
  // Without live events (the browser sandbox) only the API can have a problem.
  assert.deepEqual(collectConnectionIssues(endpoints, streams, false).map((issue) => [issue.endpointId, issue.events]), [
    ["down", undefined],
    ["expired", undefined]
  ]);
});

test("lab deep links round-trip and keep other parameters", () => {
  assert.deepEqual(parseLabDeepLink("?lab=endpoint-1::labs/srl/srl.clab.yml&node=leaf1"), {
    endpointId: "endpoint-1", path: "labs/srl/srl.clab.yml", node: "leaf1"
  });
  assert.deepEqual(parseLabDeepLink("?lab=endpoint-1%3A%3A%40shared%2Fdemo.clab.yml"), {
    endpointId: "endpoint-1", path: "@shared/demo.clab.yml"
  });
  assert.equal(parseLabDeepLink("?lab=no-separator"), null);
  assert.equal(parseLabDeepLink("?lab=::path"), null);
  assert.equal(parseLabDeepLink(""), null);

  const link = { endpointId: "endpoint-1", path: "my lab/demo.clab.yml" };
  assert.equal(withLabDeepLink("?fixture=stages", link), "?fixture=stages&lab=endpoint-1::my%20lab/demo.clab.yml");
  assert.equal(withLabDeepLink("?lab=endpoint-1::my%20lab/demo.clab.yml&node=n1", link), "?lab=endpoint-1::my%20lab/demo.clab.yml&node=n1");
  assert.equal(withLabDeepLink("?lab=endpoint-1::other.clab.yml&node=n1", link), "?lab=endpoint-1::my%20lab/demo.clab.yml");
  assert.equal(withLabDeepLink("?theme=light&lab=a::b.clab.yml&node=n1", null), "?theme=light");
  assert.equal(withLabDeepLink("?lab=a::b.clab.yml", null), "");
  assert.equal(
    labDeepLinkUrl({ origin: "https://host.test", pathname: "/sandbox/", search: "", hash: "" }, { ...link, node: "leaf 1" }),
    "https://host.test/sandbox/?lab=endpoint-1::my%20lab/demo.clab.yml&node=leaf%201"
  );
  assert.deepEqual(parseLabDeepLink(new URL(labDeepLinkUrl(
    { origin: "https://host.test", pathname: "/", search: "", hash: "#x" }, { endpointId: "e", path: "a&b.clab.yml" }
  )).search), { endpointId: "e", path: "a&b.clab.yml" });
});
