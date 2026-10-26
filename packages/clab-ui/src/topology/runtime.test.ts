import assert from "node:assert/strict";
import test from "node:test";

import type { HostRuntimeContainer } from "../host";
import type { TopoEdge } from "../core/types/graph";

import {
  buildRuntimeEdgeStatsUpdates,
  buildRuntimeNodeUpdates,
  classifyNodeReadiness,
  countReadyContainers,
  createRuntimeContainerDataProvider
} from "./runtime";

const runtimeContainers: HostRuntimeContainer[] = [
  {
    name: "clab-demo-srl1",
    nodeName: "srl1",
    labName: "demo",
    state: "running",
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:latest",
    ipv4Address: "172.20.20.2/24",
    ipv6Address: "",
    interfaces: [
      {
        name: "e1-1",
        alias: "",
        label: "ethernet-1/1",
        mac: "02:42:ac:11:00:01",
        mtu: 1500,
        state: "up",
        type: "veth",
        ifIndex: 42,
        netemState: { delay: "10ms" }
      }
    ]
  },
  {
    name: "clab-demo-srl2",
    nodeName: "srl2",
    labName: "demo",
    state: "running",
    kind: "nokia_srlinux",
    image: "ghcr.io/nokia/srlinux:latest",
    ipv4Address: "172.20.20.3/24",
    ipv6Address: "",
    interfaces: [
      {
        name: "e1-1",
        alias: "ethernet-1/1",
        mac: "02:42:ac:11:00:02",
        mtu: 1500,
        state: "up",
        type: "veth",
        ifIndex: 43
      }
    ]
  }
];

test("runtime provider resolves interfaces by display label", () => {
  const provider = createRuntimeContainerDataProvider(runtimeContainers);
  const iface = provider.findInterface("srl1", "ethernet-1/1", "demo");

  assert.equal(iface?.name, "e1-1");
  assert.equal(iface?.label, "ethernet-1/1");
  assert.equal(iface?.netemState?.delay, "10ms");
});

test("runtime provider resolves containers built from unresolved topology prefixes", () => {
  const provider = createRuntimeContainerDataProvider(runtimeContainers);
  const container = provider.findContainer('${LAB_PREFIX:-""}-demo-srl1', "demo");
  const iface = provider.findInterface('${LAB_PREFIX:-""}-demo-srl1', "ethernet-1/1", "demo");

  assert.equal(container?.name, "clab-demo-srl1");
  assert.equal(iface?.name, "e1-1");
});

test("runtime edge updates carry netem state from label-matched interfaces", () => {
  const edge: TopoEdge = {
    id: "srl1:ethernet-1/1--srl2:ethernet-1/1",
    source: "srl1",
    target: "srl2",
    data: {
      id: "srl1:ethernet-1/1--srl2:ethernet-1/1",
      source: "srl1",
      target: "srl2",
      sourceEndpoint: "ethernet-1/1",
      targetEndpoint: "ethernet-1/1",
      extraData: {}
    }
  } as TopoEdge;

  const [update] = buildRuntimeEdgeStatsUpdates([edge], runtimeContainers, {
    currentLabName: "demo",
    topology: undefined
  });

  assert.equal(update?.extraData.clabSourceInterfaceState, "up");
  assert.deepEqual(update?.extraData.clabSourceNetem, { delay: "10ms" });
});

test("runtime edge updates mark stopped node interfaces unavailable", () => {
  const edge: TopoEdge = {
    id: "srl1:ethernet-1/1--srl2:ethernet-1/1",
    source: "srl1",
    target: "srl2",
    data: {
      id: "srl1:ethernet-1/1--srl2:ethernet-1/1",
      source: "srl1",
      target: "srl2",
      sourceEndpoint: "ethernet-1/1",
      targetEndpoint: "ethernet-1/1",
      extraData: {
        clabSourceInterfaceState: "up",
        clabTargetInterfaceState: "up"
      }
    }
  } as TopoEdge;
  const [runningSource, runningTarget] = runtimeContainers;
  assert.ok(runningSource);
  assert.ok(runningTarget);

  const stoppedContainers: HostRuntimeContainer[] = [
    {
      ...runningSource,
      state: "exited",
      interfaces: []
    },
    runningTarget
  ];

  const [update] = buildRuntimeEdgeStatsUpdates([edge], stoppedContainers, {
    currentLabName: "demo",
    topology: undefined
  });

  assert.equal(update?.extraData.clabSourceInterfaceState, "");
  assert.equal(update?.extraData.clabTargetInterfaceState, "up");
});

test("runtime edge updates ignore stale interface state on stopped containers", () => {
  const edge: TopoEdge = {
    id: "srl1:ethernet-1/1--srl2:ethernet-1/1",
    source: "srl1",
    target: "srl2",
    data: {
      id: "srl1:ethernet-1/1--srl2:ethernet-1/1",
      source: "srl1",
      target: "srl2",
      sourceEndpoint: "ethernet-1/1",
      targetEndpoint: "ethernet-1/1",
      extraData: {
        clabSourceInterfaceState: "up"
      }
    }
  } as TopoEdge;
  const [runningSource, runningTarget] = runtimeContainers;
  assert.ok(runningSource);
  assert.ok(runningTarget);

  const stoppedContainers: HostRuntimeContainer[] = [
    {
      ...runningSource,
      state: "exited",
      interfaces: runningSource.interfaces?.map((iface) => ({ ...iface, state: "up" }))
    },
    runningTarget
  ];

  const [update] = buildRuntimeEdgeStatsUpdates([edge], stoppedContainers, {
    currentLabName: "demo",
    topology: undefined
  });

  assert.equal(update?.extraData.clabSourceInterfaceState, "");
});

test("runtime node updates list the capturable interfaces of each container", () => {
  const [update] = buildRuntimeNodeUpdates(
    [
      {
        ...runtimeContainers[0],
        interfaces: [
          { name: "lo", alias: "", mac: "", mtu: 65536, state: "unknown", type: "loopback" },
          { name: "e1-10", alias: "", label: "ethernet-1/10", mac: "", mtu: 9232, state: "down", type: "veth" },
          { name: "e1-2", alias: "ethernet-1/2", mac: "", mtu: 9232, state: "up", type: "veth" },
          { name: "eth0", alias: "", mac: "", mtu: 1500, state: "up", type: "veth" }
        ]
      }
    ],
    "demo"
  );

  assert.deepEqual(update.interfaces, [
    { name: "e1-2", alias: "ethernet-1/2", state: "up" },
    { name: "e1-10", alias: "ethernet-1/10", state: "down" },
    { name: "eth0", state: "up" }
  ]);
});

test("runtime node updates and container data carry the docker status line", () => {
  const containers = [{ ...runtimeContainers[0], status: "Up 4 seconds (health: starting)" }];

  const [update] = buildRuntimeNodeUpdates(containers, "demo");
  assert.equal(update.status, "Up 4 seconds (health: starting)");

  const provider = createRuntimeContainerDataProvider(containers);
  assert.equal(provider.findContainer("srl1", "demo")?.status, "Up 4 seconds (health: starting)");
  assert.equal(buildRuntimeNodeUpdates([runtimeContainers[1]], "demo")[0]?.status, "");
});

test("a node is ready when it runs healthy or without a healthcheck", () => {
  assert.equal(
    classifyNodeReadiness({ state: "running", status: "Up 5 minutes (healthy)" }),
    "ready"
  );
  assert.equal(classifyNodeReadiness({ state: "running", status: "Up 5 minutes" }), "ready");
  assert.equal(classifyNodeReadiness({ state: "running" }), "ready");
});

test("a node is starting while its container is created or its healthcheck has not passed", () => {
  assert.equal(
    classifyNodeReadiness({ state: "running", status: "Up 3 seconds (health: starting)" }),
    "starting"
  );
  assert.equal(classifyNodeReadiness({ state: "created", status: "Created" }), "starting");
  assert.equal(classifyNodeReadiness({ state: "restarting" }), "starting");
  assert.equal(classifyNodeReadiness({ state: "running", status: "Up (healthy)" }), "ready");
});

test("an unhealthy node is told apart from a starting one", () => {
  assert.equal(
    classifyNodeReadiness({ state: "running", status: "Up 9 minutes (unhealthy)" }),
    "unhealthy"
  );
});

test("lifecycle actions bring nodes up or take them down until their containers follow", () => {
  assert.equal(classifyNodeReadiness({ state: "", lifecycle: "up" }), "starting");
  assert.equal(classifyNodeReadiness({ state: "exited", lifecycle: "up" }), "starting");
  // Running nodes are past the action; their health decides.
  assert.equal(classifyNodeReadiness({ state: "running", status: "Up", lifecycle: "up" }), "ready");
  assert.equal(classifyNodeReadiness({ state: "running", lifecycle: "down" }), "stopping");
  assert.equal(classifyNodeReadiness({ state: "removing" }), "stopping");
  assert.equal(classifyNodeReadiness({ state: "exited", lifecycle: "down" }), "stopped");
  assert.equal(classifyNodeReadiness({ state: "exited" }), "stopped");
  assert.equal(classifyNodeReadiness({ state: "paused" }), "paused");
});

test("countReadyContainers counts the ready containers of a lab", () => {
  const containers: HostRuntimeContainer[] = [
    { ...runtimeContainers[0], status: "Up 1 minute (healthy)" },
    { ...runtimeContainers[1], status: "Up 2 seconds (health: starting)" },
    { ...runtimeContainers[1], name: "clab-demo-srl3", state: "exited", status: "Exited (0)" }
  ];

  assert.deepEqual(countReadyContainers(containers), { ready: 1, total: 3 });
  assert.deepEqual(countReadyContainers(containers, "down"), { ready: 0, total: 3 });
});
