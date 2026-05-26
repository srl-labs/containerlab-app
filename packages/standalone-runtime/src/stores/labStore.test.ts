import assert from "node:assert/strict";
import test from "node:test";
import { useLabStore } from "./labStore";

const ENDPOINT_ID = "endpoint-1";

function firstLab() {
  return [...useLabStore.getState().labs.values()][0];
}

test.beforeEach(() => {
  useLabStore.getState().clear();
});

test("processEvent merges interface-stats events keyed by attributes.interface", () => {
  const store = useLabStore.getState();

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "start",
    attributes: {
      name: "clab-demo-srl1",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      "container-id": "abc123",
      "clab-node-name": "srl1",
      "clab-node-kind": "nokia_srlinux",
      state: "running",
      status: "Up"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "create",
    attributes: {
      name: "clab-demo-srl1",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      ifname: "e1-1",
      alias: "ethernet-1/1",
      state: "up",
      type: "veth",
      mac: "02:42:ac:11:00:01",
      mtu: "1500"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface-stats",
    action: "stats",
    attributes: {
      name: "clab-demo-srl1",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      interface: "e1-1",
      rx_bps: 1234,
      tx_bps: 5678,
      rx_bytes: 120,
      tx_bytes: 240,
      interval_seconds: 1
    }
  });

  const container = firstLab()?.containers.get("clab-demo-srl1");
  const iface = container?.interfaces.get("e1-1");

  assert.ok(iface);
  assert.equal(iface.alias, "ethernet-1/1");
  assert.equal(iface.type, "veth");
  assert.equal(iface.mac, "02:42:ac:11:00:01");
  assert.equal(iface.rxBps, "1234");
  assert.equal(iface.txBps, "5678");
  assert.equal(iface.rxBytes, "120");
  assert.equal(iface.txBytes, "240");
  assert.equal(iface.statsIntervalSeconds, "1");
  assert.equal(iface.netemDelay, "0ms");
  assert.equal(iface.netemJitter, "0ms");
  assert.equal(iface.netemLoss, "0%");
  assert.equal(iface.netemRate, "0");
  assert.equal(iface.netemCorruption, "0");
});

test("stats-only updates preserve existing interface metadata", () => {
  const store = useLabStore.getState();

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "start",
    attributes: {
      name: "clab-demo-srl2",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "create",
    attributes: {
      name: "clab-demo-srl2",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      ifname: "eth1",
      alias: "server-link",
      state: "up",
      type: "veth",
      mac: "02:42:ac:11:00:02",
      mtu: "9000"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface-stats",
    action: "stats",
    attributes: {
      name: "clab-demo-srl2",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      interface: "eth1",
      rx_packets: 88,
      tx_packets: 99
    }
  });

  const iface = firstLab()?.containers.get("clab-demo-srl2")?.interfaces.get("eth1");
  assert.ok(iface);
  assert.equal(iface.alias, "server-link");
  assert.equal(iface.state, "up");
  assert.equal(iface.type, "veth");
  assert.equal(iface.mac, "02:42:ac:11:00:02");
  assert.equal(iface.mtu, "9000");
  assert.equal(iface.rxPackets, "88");
  assert.equal(iface.txPackets, "99");
});

test("partial interface updates preserve netem state until explicit netem values arrive", () => {
  const store = useLabStore.getState();

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "start",
    attributes: {
      name: "clab-demo-srl-netem",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "create",
    attributes: {
      name: "clab-demo-srl-netem",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      ifname: "eth1",
      alias: "server-link",
      state: "up",
      type: "veth",
      netem_delay: "25ms",
      netem_jitter: "5ms"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface-stats",
    action: "stats",
    attributes: {
      name: "clab-demo-srl-netem",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      interface: "eth1",
      rx_packets: 88
    }
  });

  let iface = firstLab()?.containers.get("clab-demo-srl-netem")?.interfaces.get("eth1");
  assert.ok(iface);
  assert.equal(iface.netemDelay, "25ms");
  assert.equal(iface.netemJitter, "5ms");
  assert.equal(iface.rxPackets, "88");

  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "update",
    attributes: {
      name: "clab-demo-srl-netem",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      ifname: "eth1",
      state: "up"
    }
  });

  iface = firstLab()?.containers.get("clab-demo-srl-netem")?.interfaces.get("eth1");
  assert.ok(iface);
  assert.equal(iface.netemDelay, "25ms");
  assert.equal(iface.netemJitter, "5ms");

  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "update",
    attributes: {
      name: "clab-demo-srl-netem",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      ifname: "eth1",
      netem_delay: "0ms"
    }
  });

  iface = firstLab()?.containers.get("clab-demo-srl-netem")?.interfaces.get("eth1");
  assert.ok(iface);
  assert.equal(iface.netemDelay, "0ms");
  assert.equal(iface.netemJitter, "5ms");
});

test("API-driven netem updates change the stored runtime interface state", () => {
  const store = useLabStore.getState();

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "start",
    attributes: {
      name: "clab-demo-srl-netem",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      "clab-node-name": "srl-netem"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "create",
    attributes: {
      name: "clab-demo-srl-netem",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      ifname: "eth1",
      alias: "ethernet-1/1",
      netem_delay: "100ms",
      netem_jitter: "5ms"
    }
  });

  store.updateInterfaceNetemState({
    endpointId: ENDPOINT_ID,
    topologyPath: "/labs/demo.clab.yml",
    labName: "demo",
    nodeName: "srl-netem",
    interfaceName: "ethernet-1/1",
    netem: {
      netemDelay: "0ms",
      netemJitter: "0ms",
      netemLoss: "0%",
      netemRate: "0",
      netemCorruption: "0"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface-stats",
    action: "stats",
    attributes: {
      name: "clab-demo-srl-netem",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      interface: "eth1",
      rx_packets: 88
    }
  });

  const iface = firstLab()?.containers.get("clab-demo-srl-netem")?.interfaces.get("eth1");
  assert.ok(iface);
  assert.equal(iface.netemDelay, "0ms");
  assert.equal(iface.netemJitter, "0ms");
  assert.equal(iface.netemLoss, "0%");
  assert.equal(iface.netemRate, "0");
  assert.equal(iface.netemCorruption, "0");
  assert.equal(iface.rxPackets, "88");
});

test("API-driven netem updates fall back to lab and node matching when topology paths differ", () => {
  const store = useLabStore.getState();

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "start",
    attributes: {
      name: "clab-demo-srl-netem",
      lab: "demo",
      "lab-path": "/runtime/path/demo.clab.yml",
      "clab-node-name": "srl-netem"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "create",
    attributes: {
      name: "clab-demo-srl-netem",
      lab: "demo",
      "lab-path": "/runtime/path/demo.clab.yml",
      ifname: "eth1",
      alias: "ethernet-1/1",
      netem_delay: "100ms"
    }
  });

  store.updateInterfaceNetemState({
    endpointId: ENDPOINT_ID,
    topologyPath: "/topology/session/path/demo.clab.yml",
    labName: "demo",
    nodeName: "srl-netem",
    interfaceName: "ethernet-1/1",
    netem: {
      netemDelay: "0ms"
    }
  });

  const iface = firstLab()?.containers.get("clab-demo-srl-netem")?.interfaces.get("eth1");
  assert.ok(iface);
  assert.equal(iface.netemDelay, "0ms");
});

test("interface events without lab-path are matched to an existing lab via container name", () => {
  const store = useLabStore.getState();

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "start",
    attributes: {
      name: "clab-demo-srl3",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "snapshot",
    attributes: {
      name: "clab-demo-srl3",
      lab: "demo",
      ifname: "e1-1",
      alias: "ethernet-1/1",
      state: "up",
      type: "veth"
    }
  });

  const iface = firstLab()?.containers.get("clab-demo-srl3")?.interfaces.get("e1-1");
  assert.ok(iface);
  assert.equal(iface.alias, "ethernet-1/1");
  assert.equal(iface.state, "up");
});

test("renamed interface events remove stale entries with the same index", () => {
  const store = useLabStore.getState();

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "start",
    attributes: {
      name: "clab-demo-srl-renamed",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "create",
    attributes: {
      name: "clab-demo-srl-renamed",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      ifname: "eth1",
      state: "up",
      index: "42"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "create",
    attributes: {
      name: "clab-demo-srl-renamed",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      ifname: "e1-1",
      alias: "ethernet-1/1",
      state: "up",
      ifindex: "42"
    }
  });

  const interfaces = firstLab()?.containers.get("clab-demo-srl-renamed")?.interfaces;
  assert.ok(interfaces);
  assert.equal(interfaces.has("eth1"), false);
  assert.equal(interfaces.has("e1-1"), true);
  assert.equal(interfaces.get("e1-1")?.label, "ethernet-1/1");
});

test("interface stats can resolve container name from actor_name when attributes.name is absent", () => {
  const store = useLabStore.getState();

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "start",
    attributes: {
      name: "clab-demo-srl4",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "create",
    attributes: {
      name: "clab-demo-srl4",
      lab: "demo",
      ifname: "eth1",
      state: "up",
      type: "veth"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "stats",
    actor_name: "clab-demo-srl4",
    attributes: {
      lab: "demo",
      interface: "eth1",
      rx_bps: 1111,
      tx_bps: 2222
    }
  } as unknown as Parameters<typeof store.processEvent>[1]);

  const iface = firstLab()?.containers.get("clab-demo-srl4")?.interfaces.get("eth1");
  assert.ok(iface);
  assert.equal(iface.rxBps, "1111");
  assert.equal(iface.txBps, "2222");
});

test("processEvent keeps duplicate lab names separate when topology paths differ", () => {
  const store = useLabStore.getState();

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "start",
    attributes: {
      name: "clab-demo-a-srl1",
      lab: "demo",
      "lab-path": "/labs/demo-a.clab.yml"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "start",
    attributes: {
      name: "clab-demo-b-srl1",
      lab: "demo",
      "lab-path": "/labs/demo-b.clab.yml"
    }
  });

  const labs = [...useLabStore.getState().labs.values()];
  assert.equal(labs.length, 2);
  assert.deepEqual(
    labs.map((lab) => lab.topologyPath).sort(),
    ["/labs/demo-a.clab.yml", "/labs/demo-b.clab.yml"]
  );
});

test("processEvent creates a lab from pathless lifecycle events and migrates to path when available", () => {
  const store = useLabStore.getState();

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "start",
    attributes: {
      name: "clab-demo-srl1",
      lab: "demo",
      "clab-node-name": "srl1",
      state: "running"
    }
  });

  assert.equal(useLabStore.getState().labsByEndpoint.get(ENDPOINT_ID)?.has("name:demo"), true);

  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "create",
    attributes: {
      name: "clab-demo-srl1",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      ifname: "e1-1",
      state: "up"
    }
  });

  const endpointLabs = useLabStore.getState().labsByEndpoint.get(ENDPOINT_ID);
  assert.equal(endpointLabs?.has("name:demo"), false);
  assert.equal(endpointLabs?.has("path:/labs/demo.clab.yml"), true);
  assert.ok(endpointLabs?.get("path:/labs/demo.clab.yml")?.containers.get("clab-demo-srl1"));
});

test("processEvent marks die events as stopped until a removal event arrives", () => {
  const store = useLabStore.getState();

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "start",
    attributes: {
      name: "clab-demo-srl1",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      "clab-node-name": "srl1",
      state: "running"
    }
  });
  store.processEvent(ENDPOINT_ID, {
    type: "interface",
    action: "create",
    attributes: {
      name: "clab-demo-srl1",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      ifname: "e1-1",
      state: "up"
    }
  });

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "die",
    attributes: {
      name: "clab-demo-srl1",
      lab: "demo"
    }
  });

  let container = firstLab()?.containers.get("clab-demo-srl1");
  assert.ok(container);
  assert.equal(container.state, "exited");
  assert.equal(container.status, "Exited");
  assert.equal(container.interfaces.get("e1-1")?.state, "down");

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "destroy",
    attributes: {
      name: "clab-demo-srl1",
      lab: "demo"
    }
  });

  container = firstLab()?.containers.get("clab-demo-srl1");
  assert.equal(container, undefined);
  assert.equal(useLabStore.getState().labs.size, 0);
});

test("removeLabByTopology removes endpoint-scoped lab state", () => {
  const store = useLabStore.getState();

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "start",
    attributes: {
      name: "clab-demo-srl1",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      state: "running"
    }
  });

  store.removeLabByTopology({
    endpointId: ENDPOINT_ID,
    topologyPath: "/labs/demo.clab.yml"
  });

  assert.equal(useLabStore.getState().labs.size, 0);
  assert.equal(useLabStore.getState().labsByEndpoint.get(ENDPOINT_ID), undefined);

  store.processEvent(ENDPOINT_ID, {
    type: "interface-stats",
    action: "stats",
    attributes: {
      name: "clab-demo-srl1",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml",
      interface: "e1-1",
      state: "up"
    }
  });

  const container = firstLab()?.containers.get("clab-demo-srl1");
  assert.equal(container?.state, "up");
  assert.notEqual(container?.state, "exited");
});

test("replaceLabSnapshot refreshes state and drops stale containers", () => {
  const store = useLabStore.getState();

  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "die",
    attributes: {
      name: "clab-demo-srl1",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml"
    }
  });
  store.processEvent(ENDPOINT_ID, {
    type: "container",
    action: "die",
    attributes: {
      name: "clab-demo-srl2",
      lab: "demo",
      "lab-path": "/labs/demo.clab.yml"
    }
  });

  store.replaceLabSnapshot({
    endpointId: ENDPOINT_ID,
    labName: "demo",
    topologyPath: "/labs/demo.clab.yml",
    containers: [
      {
        name: "clab-demo-srl1",
        labName: "demo",
        absLabPath: "/labs/demo.clab.yml",
        nodeName: "srl1",
        status: "Up 2 seconds"
      }
    ]
  });

  const lab = firstLab();
  assert.ok(lab);
  assert.equal(lab.containers.size, 1);
  assert.equal(lab.containers.get("clab-demo-srl2"), undefined);
  const container = lab.containers.get("clab-demo-srl1");
  assert.equal(container?.state, "running");
  assert.equal(container?.status, "Up 2 seconds");
  assert.equal(container?.nodeName, "srl1");
});
