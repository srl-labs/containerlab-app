import assert from "node:assert/strict";
import { test } from "node:test";

import { linkHoverEndpoints, linkHoverState, netemSummary } from "./linkHoverDetails";

test("a link's endpoints come from its endpoints and the lab host's interface data", () => {
  const [a, b] = linkHoverEndpoints({
    source: "srl1",
    target: "srl2",
    data: {
      sourceEndpoint: "e1-1",
      targetEndpoint: "e1-2",
      extraData: {
        clabSourceInterfaceState: "UP",
        clabSourceMacAddress: "aa:c1:ab:00:00:01",
        clabSourceMtu: 9500,
        clabSourceStats: { rxBps: 1200, txBps: 800 },
        clabSourceNetem: { delay: "10ms", jitter: "0ms", loss: "5%", rate: "0", corruption: "" },
        clabTargetInterfaceState: "down"
      }
    }
  });
  assert.deepEqual(a, {
    node: "srl1",
    interface: "e1-1",
    state: "up",
    mac: "aa:c1:ab:00:00:01",
    mtu: "9500",
    stats: { rxBps: 1200, txBps: 800 },
    impairment: "delay 10ms, loss 5%"
  });
  assert.deepEqual(b, { node: "srl2", interface: "e1-2", state: "down", mac: "", mtu: "" });
  assert.equal(linkHoverState([a, b]), "down");
});

test("a link is up when both ends are, unknown before the lab host reports them", () => {
  const end = { node: "n", interface: "e", mac: "", mtu: "" };
  assert.equal(linkHoverState([{ ...end, state: "up" }, { ...end, state: "up" }]), "up");
  assert.equal(linkHoverState([{ ...end, state: "up" }, { ...end, state: "" }]), "unknown");
});

test("impairments that change nothing are left out", () => {
  assert.equal(netemSummary({ delay: "0ms", loss: "0", rate: "0", corruption: "0%" }), undefined);
  assert.equal(netemSummary(undefined), undefined);
  assert.equal(netemSummary({ rate: "1000", corruption: "0.5" }), "rate 1000 kbps, corruption 0.5%");
});
