import assert from "node:assert/strict";
import test from "node:test";

import { groupCaptureSelection, type CaptureInterfaceOption } from "./captureInterfaceOptions";
import { captureGroupLabel, summarizeCapture, summarizeLinkCapture } from "./captureSummary";
import { linkCaptureOptions } from "./linkCaptureOptions";

function option(name: string, label: string, extra: Partial<CaptureInterfaceOption> = {}): CaptureInterfaceOption {
  return {
    name,
    label,
    nodeNamespace: true,
    hostNetns: false,
    state: "up",
    containerName: "clab-capui-sr2",
    isManagement: false,
    ...extra
  };
}

const options = [
  option("eth0", "eth0", { isManagement: true }),
  option("e1-1-c1-1", "1/1/c1/1"),
  option("e1-1-c2-1", "1/1/c2/1"),
  option("clab-s-1234", "1/1/c3/1", { nodeNamespace: false, hostNetns: true })
];

function summary(names: string[], separate = false) {
  const selected = new Set(names);
  return summarizeCapture(options, selected, groupCaptureSelection(options, selected, { separate }), separate);
}

test("the submit label names a single interface", () => {
  assert.deepEqual(summary([]), { submitLabel: "Select interfaces to capture" });
  assert.deepEqual(summary(["e1-1-c1-1"]), { submitLabel: "Capture 1/1/c1/1" });
  assert.deepEqual(summary(["e1-1-c1-1"], true), { submitLabel: "Capture 1/1/c1/1" });
});

test("several interfaces in one Wireshark are counted, one per interface counts the windows", () => {
  assert.deepEqual(summary(["eth0", "e1-1-c1-1", "e1-1-c2-1"]), {
    submitLabel: "Capture 3 interfaces"
  });
  assert.deepEqual(summary(["eth0", "e1-1-c1-1", "e1-1-c2-1"], true), {
    submitLabel: "Open 3 Wiresharks"
  });
});

test("explains when one Wireshark is not possible", () => {
  assert.deepEqual(summary(["e1-1-c1-1", "clab-s-1234"]), {
    submitLabel: "Open 2 Wiresharks",
    hint: "1/1/c3/1 is only reachable from the host side, so 2 Wiresharks open."
  });

  const spread = [option("e1-1", "e1-1"), option("e1-2", "e1-2", { containerName: "clab-capui-sr1-b" })];
  const selected = new Set(["e1-1", "e1-2"]);
  assert.equal(
    summarizeCapture(spread, selected, groupCaptureSelection(spread, selected), false).hint,
    "These interfaces belong to different containers, so they open in 2 Wiresharks."
  );
});

test("a session is named after the interfaces as the user knows them", () => {
  const [group] = groupCaptureSelection(options, new Set(["e1-1-c1-1", "e1-1-c2-1"]));
  assert.equal(captureGroupLabel(options, group), "1/1/c1/1, 1/1/c2/1");
});

const linkEnds = [
  { id: "source", nodeId: "sr1", captureName: "clab-capui-sr1-a", displayName: "sr1", endpoint: "1/1/c1/1" },
  { id: "target", nodeId: "srl1", captureName: "clab-capui-srl1", displayName: "srl1", endpoint: "e1-1" }
] as const;

function linkSummary(shared: boolean, names: string[], separate = false) {
  const ends = linkCaptureOptions(linkEnds, shared);
  const selected = new Set(names);
  return summarizeLinkCapture(ends, selected, groupCaptureSelection(ends, selected, { separate }));
}

test("a link names its ends with their node", () => {
  assert.deepEqual(linkSummary(true, []), { submitLabel: "Select the ends to capture" });
  assert.deepEqual(linkSummary(true, ["target"]), { submitLabel: "Capture srl1 · e1-1" });
});

test("stitched link ends open in one Wireshark, or one per end", () => {
  assert.deepEqual(linkSummary(true, ["source", "target"]), {
    submitLabel: "Capture both ends",
    hint: "Each packet shows up once per end."
  });
  assert.deepEqual(linkSummary(true, ["source", "target"], true), { submitLabel: "Open 2 Wiresharks" });
});

test("ends in two node namespaces always open one Wireshark each", () => {
  assert.deepEqual(linkSummary(false, ["source", "target"]), {
    submitLabel: "Open 2 Wiresharks",
    hint: "The ends are in different network namespaces, so each opens in its own Wireshark."
  });
});
