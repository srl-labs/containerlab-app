import assert from "node:assert/strict";
import test from "node:test";

import { describeFieldVariables } from "./fieldVariablePreview";

const local = {
  labName: "dc",
  nodeName: "srl1",
  variables: { topologyDir: "/home/u/labs", env: { IMAGE: "srl:25" } }
};

test("values without variables have no preview", () => {
  assert.equal(describeFieldVariables("ghcr.io/nokia/srlinux", local, true), undefined);
  // Magic variables only resolve in fields where containerlab expands them.
  assert.equal(describeFieldVariables("__clabNodeDir__/cfg", local, false), undefined);
});

test("env variables resolve from the host environment", () => {
  assert.equal(describeFieldVariables("${IMAGE:=srl:24}", local, false), "Resolves to: srl:25");
  assert.equal(
    describeFieldVariables("${TAG:=latest} $MISSING", local, false),
    "Resolves to: latest $MISSING ($MISSING not set)"
  );
});

test("without the host environment the defaults are shown and marked", () => {
  const api = { labName: "dc", nodeName: "srl1", variables: { topologyDir: "/srv/labs" } };
  assert.equal(
    describeFieldVariables("${IMAGE:=srl:24}", api, false),
    "Resolves to: srl:24 (defaults shown, the lab host's environment can set $IMAGE)"
  );
});

test("magic variables resolve for the node", () => {
  assert.equal(
    describeFieldVariables("__clabNodeDir__/startup.cfg", local, true),
    "Resolves to: /home/u/labs/clab-dc/srl1/startup.cfg"
  );
  assert.equal(
    describeFieldVariables("configs/__clabNodeName__.cfg", { labName: "dc" }, true),
    "Resolves to: configs/__clabNodeName__.cfg"
  );
});
