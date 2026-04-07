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
