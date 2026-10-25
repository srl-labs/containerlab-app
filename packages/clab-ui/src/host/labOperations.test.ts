import assert from "node:assert/strict";
import test from "node:test";

import {
  createLabOperationsRequester,
  isValidLabelFilter,
  nodeNameForContainer,
  parseExecResponse,
  parseInspectDetails,
  parseLabOperationSupport,
  parseSaveConfigsResponse,
  parseSnapshotSaveResponse
} from "./labOperations";

test("containers map to their topology node", () => {
  assert.equal(nodeNameForContainer("clab-lab1-leaf1", ["leaf1", "leaf10"]), "leaf1");
  assert.equal(nodeNameForContainer("clab-lab1-spine-a", ["a", "spine-a"]), "spine-a");
  assert.equal(nodeNameForContainer("leaf1", ["leaf1"]), "leaf1");
  assert.equal(nodeNameForContainer("clab-lab1-r9", [], "lab1"), "r9");
  assert.equal(nodeNameForContainer("custom-r9", [], "lab1"), "custom-r9");
});

test("label filters are key=value", () => {
  assert.equal(isValidLabelFilter("role=spine"), true);
  assert.equal(isValidLabelFilter("clab-node-kind=nokia_srlinux"), true);
  assert.equal(isValidLabelFilter("graph-level="), false);
  assert.equal(isValidLabelFilter("-x=1"), false);
  assert.equal(isValidLabelFilter("role"), false);
  assert.equal(isValidLabelFilter("role=a,b"), false);
  assert.equal(isValidLabelFilter("ro le=x"), false);
});

test("support flags are true only when the host says so", () => {
  assert.deepEqual(parseLabOperationSupport({ execByLabel: true, saveCopy: "yes" }), {
    execByLabel: true,
    snapshotSave: false,
    deployRestore: false,
    saveCopy: false,
    inspectDetails: false
  });
  assert.equal(parseLabOperationSupport(undefined).inspectDetails, false);
});

test("exec results are read from both JSON spellings", () => {
  const result = parseExecResponse(
    {
      "clab-lab1-r2": [{ cmd: ["ip", "a"], "return-code": 1, stdout: "", stderr: "boom" }],
      "clab-lab1-r1": [{ Cmd: ["ip", "a"], ReturnCode: 0, Stdout: { up: true }, Stderr: "" }],
      ignored: []
    },
    ["r1", "r2"]
  );
  assert.deepEqual(result.results, [
    {
      container: "clab-lab1-r1",
      node: "r1",
      returnCode: 0,
      stdout: '{\n  "up": true\n}',
      stderr: ""
    },
    { container: "clab-lab1-r2", node: "r2", returnCode: 1, stdout: "", stderr: "boom" }
  ]);
  assert.deepEqual(parseExecResponse("nope").results, []);
});

test("snapshot results keep per-node status", () => {
  const result = parseSnapshotSaveResponse({
    outputDir: "lab/snapshots",
    results: [
      { node: "vm1", status: "success", path: "lab/snapshots/vm1.tar", sizeBytes: 10, durationMs: 5 },
      { node: "ctr", status: "skipped", reason: "not a vrnetlab node" },
      { node: "vm2", status: "weird", error: "timeout" },
      { status: "success" }
    ]
  });
  assert.equal(result.outputDir, "lab/snapshots");
  assert.deepEqual(
    result.results.map((entry) => [entry.node, entry.status]),
    [
      ["ctr", "skipped"],
      ["vm1", "success"],
      ["vm2", "failed"]
    ]
  );
  assert.equal(result.summary, "1 succeeded, 1 failed, 1 skipped");
});

test("save results carry the copy directory when there is one", () => {
  assert.deepEqual(parseSaveConfigsResponse({ message: "ok", output: "done", copyDir: "cfg" }), {
    message: "ok",
    output: "done",
    copyDir: "cfg"
  });
  assert.deepEqual(parseSaveConfigsResponse({ message: "ok" }), { message: "ok", output: "" });
});

test("inspect details are read per container", () => {
  const result = parseInspectDetails(
    {
      lab1: [
        { Names: ["/clab-lab1-r2"], Labels: { "clab-node-name": "r2" }, State: "running" },
        { Names: ["clab-lab1-r1"], Labels: {} },
        { Labels: {} }
      ]
    },
    ["r1"]
  );
  assert.deepEqual(
    result.containers.map((entry) => [entry.container, entry.node]),
    [
      ["clab-lab1-r1", "r1"],
      ["clab-lab1-r2", "r2"]
    ]
  );
  assert.equal(result.containers[1]?.details.State, "running");
});

test("the requester correlates operations with results", async () => {
  const messages: Array<Record<string, unknown>> = [];
  const handlers = new Set<(event: MessageEvent<unknown>) => void>();
  let id = 0;
  const host = createLabOperationsRequester({
    postMessage: (message) => messages.push(message as Record<string, unknown>),
    subscribe: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    requestMessage: "labOperation",
    resultMessage: "lab-operation-result",
    newId: () => `req-${++id}`
  });
  const dispatch = (data: unknown) => {
    for (const handler of handlers) handler({ data } as MessageEvent<unknown>);
  };

  const exec = host.exec({ command: "uptime", nodeNames: ["r1"] });
  const details = host.inspectDetails();
  assert.deepEqual(messages, [
    {
      command: "labOperation",
      requestId: "req-1",
      operation: "exec",
      request: { command: "uptime", nodeNames: ["r1"] }
    },
    { command: "labOperation", requestId: "req-2", operation: "inspectDetails" }
  ]);

  dispatch({ type: "lab-operation-result", requestId: "req-2", success: false, error: "old server" });
  dispatch({
    type: "lab-operation-result",
    requestId: "req-1",
    success: true,
    result: { "clab-x-r1": [{ "return-code": 0, stdout: "up", stderr: "" }] }
  });

  assert.deepEqual((await exec).results.map((entry) => entry.node), ["r1"]);
  await assert.rejects(details, /old server/);
});
