import assert from "node:assert/strict";
import test from "node:test";

import {
  expandLabNameGitTokens,
  hasEnvReferences,
  isTopologyFileName,
  isTopologyTemplateFileName,
  listEnvReferences,
  literalTopologyName,
  magicVariableValues,
  resolveEnvReferences,
  resolveMagicVariables,
  topologyFileStem
} from "./topologyVariables";

test("topology file names include templates", () => {
  assert.equal(isTopologyFileName("lab.clab.yml"), true);
  assert.equal(isTopologyFileName("lab.clab.YAML"), true);
  assert.equal(isTopologyFileName("lab.clab.gotmpl"), true);
  assert.equal(isTopologyFileName("lab.gotmpl"), false);
  assert.equal(isTopologyFileName("lab.clab_vars.yml"), false);
  assert.equal(isTopologyTemplateFileName("dir/lab.clab.gotmpl"), true);
  assert.equal(isTopologyTemplateFileName("lab.clab.yml"), false);
  assert.equal(topologyFileStem("labs/fabric.clab.gotmpl"), "fabric");
  assert.equal(topologyFileStem("fabric.clab.yaml"), "fabric");
});

test("a literal lab name is read without parsing the template", () => {
  assert.equal(literalTopologyName("# lab\nname: fabric\ntopology: {}\n"), "fabric");
  assert.equal(literalTopologyName("name: \"dc-__gitBranch__\" # comment\n"), "dc-__gitBranch__");
  assert.equal(literalTopologyName("name: {{ .name }}\n"), undefined);
  assert.equal(literalTopologyName("topology:\n  name: nested\n"), undefined);
});

test("git tokens expand like containerlab, with slashes in branches replaced", () => {
  assert.equal(
    expandLabNameGitTokens("lab-__gitBranch__-__gitHash__", { branch: "feat/x", hash: "abc1234" }),
    "lab-feat-x-abc1234"
  );
  assert.equal(expandLabNameGitTokens("lab", { branch: "main", hash: "abc1234" }), "lab");
  assert.equal(expandLabNameGitTokens("__gitBranch__", { branch: "none", hash: "none" }), "none");
});

test("env substitution follows containerlab's rules", () => {
  const env = { IMAGE: "srl:25", EMPTY: "", OTHER: "x" };
  assert.deepEqual(resolveEnvReferences("img ${IMAGE:=srl:24}", env), {
    text: "img srl:25",
    references: [{ name: "IMAGE", source: "environment" }]
  });
  assert.deepEqual(resolveEnvReferences("${MISSING:=srl:24}", env), {
    text: "srl:24",
    references: [{ name: "MISSING", source: "default" }]
  });
  // A variable without a value stays in the text.
  assert.equal(resolveEnvReferences("${MISSING}/$EMPTY", env).text, "$MISSING/$EMPTY");
  assert.equal(resolveEnvReferences("$OTHER-$$-$1-${1}", env).text, "x-$-$1-${1}");
  assert.equal(resolveEnvReferences("${OTHER:+set}${MISSING:+set}", env).text, "set");
  assert.equal(resolveEnvReferences("${MISSING:-$OTHER}", env).text, "x");
});

test("without the host environment only defaults resolve", () => {
  const resolved = resolveEnvReferences("${IMAGE:=srl:24} $HOME", undefined);
  assert.equal(resolved.text, "srl:24 $HOME");
  assert.deepEqual(resolved.references, [
    { name: "IMAGE", source: "host" },
    { name: "HOME", source: "host" }
  ]);
  assert.equal(hasEnvReferences("plain $$ text"), false);
  assert.equal(hasEnvReferences("${A:=b}"), true);
});

test("env references are listed for the host to look up", () => {
  assert.deepEqual(listEnvReferences("a: ${B:=x}\nc: $A $1 $$"), ["A", "B", "CLAB_LABDIR_BASE"]);
});

test("magic variables resolve per node", () => {
  const context = { labName: "dc", nodeName: "srl1", topologyDir: "/home/u/labs" };
  assert.deepEqual(magicVariableValues(context), {
    __clabNodeName__: "srl1",
    __clabNodeDir__: "/home/u/labs/clab-dc/srl1",
    __clabDir__: "/home/u/labs/clab-dc",
    __clabLabName__: "clab-dc"
  });
  assert.equal(
    resolveMagicVariables("__clabNodeDir__/config.cfg:/cfg", {
      ...context,
      env: { CLAB_LABDIR_BASE: "/var/labs" }
    }),
    "/var/labs/clab-dc/srl1/config.cfg:/cfg"
  );
  assert.equal(resolveMagicVariables("__clabNodeName__", { labName: "dc" }), "__clabNodeName__");
  assert.equal(resolveMagicVariables("__clabDir__", { labName: "dc" }), "./clab-dc");
});
