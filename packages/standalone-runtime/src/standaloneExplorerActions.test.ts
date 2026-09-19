import assert from "node:assert/strict";
import test from "node:test";
import { resolveArchiveLabFolder } from "./standaloneExplorerActions";

test("shared topology archives select their lab folder and never the whole shared workspace", () => {
  const ref = { topologyId: "test", labName: "demo", source: "standalone" as const };
  assert.equal(resolveArchiveLabFolder({ topologyRef: { ...ref, yamlPath: "@shared/team/demo.clab.yml" } }), "@shared/team");
  assert.equal(resolveArchiveLabFolder({ topologyRef: { ...ref, yamlPath: "@shared/demo.clab.yml" } }), undefined);
  assert.equal(resolveArchiveLabFolder({ topologyRef: { ...ref, yamlPath: "team/demo.clab.yml" } }), "team");
});
