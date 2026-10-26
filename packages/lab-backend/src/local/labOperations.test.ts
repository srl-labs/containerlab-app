import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  localExec,
  localInspectDetails,
  localNodesAction,
  localOperationSupport,
  localSaveSnapshots,
  parseSnapshotLog
} from "./labOperations.ts";
import { resolveLocalOptions } from "./options.ts";

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lab-backend-ops-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

/**
 * A `containerlab` stand-in: appends each call's arguments (one per line, then
 * `--`) to `calls`, prints `stdout` and `stderr`, and exits with `exitCode`.
 */
async function fakeContainerlab(
  directory: string,
  output: { stdout?: string; stderr?: string; exitCode?: number }
): Promise<string> {
  const script = path.join(directory, "containerlab");
  await fs.writeFile(
    script,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$@" -- >> "${directory}/calls"`,
      `cat <<'OUT'\n${output.stdout ?? ""}\nOUT`,
      `cat <<'ERR' >&2\n${output.stderr ?? ""}\nERR`,
      `exit ${output.exitCode ?? 0}`
    ].join("\n"),
    { mode: 0o755 }
  );
  return script;
}

async function calls(directory: string): Promise<string[][]> {
  const text = await fs.readFile(path.join(directory, "calls"), "utf8");
  return text
    .split("--\n")
    .map((call) => call.split("\n").filter(Boolean))
    .filter((call) => call.length > 0);
}

test("the installed containerlab version decides what is supported", () => {
  assert.deepEqual(localOperationSupport("0.71.3"), {
    execByLabel: true,
    snapshotSave: false,
    deployRestore: false,
    saveCopy: false,
    inspectDetails: true,
    hostScript: true
  });
  assert.equal(localOperationSupport("0.71.3", false).hostScript, false);
  assert.equal(localOperationSupport("0.72.0").snapshotSave, true);
  assert.equal(localOperationSupport("0.72.0").saveCopy, false);
  assert.equal(localOperationSupport("v0.81.1").saveCopy, true);
  assert.equal(localOperationSupport("1.0.0").deployRestore, true);
  assert.equal(localOperationSupport(undefined).snapshotSave, true);
});

test("snapshot logs turn into per-node results", () => {
  const results = parseSnapshotLog(
    [
      "12:00:00 INFO Creating snapshots for 3 node(s)...",
      "12:00:01 INFO ctr: skipping (not a vrnetlab node (kind=linux, image=alpine))",
      '12:01:00 INFO snapshot saved node=vm1 path=/lab/snapshots/vm1.tar size="1.2 GiB" duration=59s',
      "12:01:02 ERRO vm2: failed to copy snapshot: no such file",
      "12:01:03 INFO Summary: 1 succeeded, 1 failed, 1 skipped (1.2 GiB total)"
    ].join("\n")
  );
  assert.deepEqual(results, [
    {
      node: "ctr",
      status: "skipped",
      reason: "not a vrnetlab node (kind=linux, image=alpine)"
    },
    { node: "vm1", status: "success", path: "/lab/snapshots/vm1.tar" },
    { node: "vm2", status: "failed", error: "failed to copy snapshot: no such file" }
  ]);
});

test("exec runs once per chosen node, inside the lab, with the labels", async (t) => {
  const directory = await temporaryDirectory(t);
  const binaryPath = await fakeContainerlab(directory, {
    stdout: '{"clab-lab1-r1":[{"cmd":["uptime"],"return-code":0,"stdout":"up","stderr":""}]}'
  });
  const options = resolveLocalOptions({ binaryPath, workspaceRoot: directory });
  const topology = path.join(directory, "lab1.clab.yml");

  const result = await localExec(
    options,
    { topology, labName: "lab1" },
    { command: "uptime -p", nodeNames: ["r1", "r2", "r1"], labels: ["role=leaf"] }
  );
  assert.deepEqual(Object.keys(result), ["clab-lab1-r1"]);
  const made = await calls(directory);
  assert.equal(made.length, 2);
  assert.deepEqual(made[0], [
    "exec",
    "-r",
    "docker",
    "-t",
    topology,
    "--cmd=uptime -p",
    "--format",
    "json",
    "--label",
    "role=leaf",
    "--label",
    "clab-node-name=r1"
  ]);
  assert.deepEqual(made[1]?.slice(-2), ["--label", "clab-node-name=r2"]);
});

test("exec without a topology file stays in the lab by its label", async (t) => {
  const directory = await temporaryDirectory(t);
  const binaryPath = await fakeContainerlab(directory, {
    stdout: '{"clab-lab1-r1":[{"return-code":0,"stdout":"","stderr":""}]}'
  });
  const options = resolveLocalOptions({ binaryPath, workspaceRoot: directory });
  await localExec(options, { labName: "lab1" }, { command: "true" });
  const [call] = await calls(directory);
  assert.deepEqual(call?.slice(3, 5), ["--label", "containerlab=lab1"]);
});

test("exec rejects bad input before running anything", async (t) => {
  const directory = await temporaryDirectory(t);
  const binaryPath = await fakeContainerlab(directory, { stdout: "{}" });
  const options = resolveLocalOptions({ binaryPath, workspaceRoot: directory });
  const lab = { topology: path.join(directory, "lab1.clab.yml"), labName: "lab1" };
  await assert.rejects(localExec(options, lab, { command: "  " }), { status: 400 });
  await assert.rejects(localExec(options, lab, { command: "ls", labels: ["role"] }), { status: 400 });
  await assert.rejects(localExec(options, lab, { command: "ls", nodeNames: ["a;b"] }), { status: 400 });
  await assert.rejects(localExec(options, lab, { command: "ls" }), { status: 404 });
});

test("several nodes start in one containerlab call", async (t) => {
  const directory = await temporaryDirectory(t);
  const binaryPath = await fakeContainerlab(directory, {
    stderr: "12:00:00 INFO Starting nodes nodes=[r1 r2]"
  });
  const options = resolveLocalOptions({ binaryPath, workspaceRoot: directory });
  const topology = path.join(directory, "lab1.clab.yml");
  const result = await localNodesAction(options, { topology, labName: "lab1" }, ["r1", "r2"], "start");
  assert.equal(result.message, "Nodes r1, r2 started successfully.");
  assert.deepEqual(result.logs, ["12:00:00 INFO Starting nodes nodes=[r1 r2]"]);
  assert.deepEqual((await calls(directory))[0], [
    "start",
    "-r",
    "docker",
    "-t",
    topology,
    "--node",
    "r1,r2"
  ]);
  await assert.rejects(localNodesAction(options, { topology, labName: "lab1" }, [], "stop"), {
    status: 400
  });
});

test("inspect details reads the grouped JSON", async (t) => {
  const directory = await temporaryDirectory(t);
  const binaryPath = await fakeContainerlab(directory, {
    stdout: '{"lab1":[{"Names":["clab-lab1-r1"],"Labels":{"clab-node-name":"r1"}}]}'
  });
  const options = resolveLocalOptions({ binaryPath, workspaceRoot: directory });
  const details = await localInspectDetails(options, { labName: "lab1" });
  assert.deepEqual(Object.keys(details), ["lab1"]);
  assert.deepEqual((await calls(directory))[0], [
    "inspect",
    "-r",
    "docker",
    "--name",
    "lab1",
    "--details"
  ]);
});

test("snapshots go next to the topology and report sizes", async (t) => {
  const directory = await temporaryDirectory(t);
  await fs.mkdir(path.join(directory, "snaps"));
  await fs.writeFile(path.join(directory, "snaps", "vm1.tar"), "12345");
  const binaryPath = await fakeContainerlab(directory, {
    stderr: `12:00:00 INFO snapshot saved node=vm1 path=${path.join(directory, "snaps", "vm1.tar")} size="5 B"`
  });
  const options = resolveLocalOptions({ binaryPath, workspaceRoot: directory });
  const topology = path.join(directory, "lab1.clab.yml");
  const result = await localSaveSnapshots(options, topology, {
    outputDir: "snaps",
    nodeNames: ["vm1"],
    timeout: "10m"
  });
  assert.equal(result.outputDir, path.join(directory, "snaps"));
  assert.deepEqual(result.results, [
    { node: "vm1", status: "success", path: path.join(directory, "snaps", "vm1.tar"), sizeBytes: 5 }
  ]);
  assert.equal(result.summary, "1 succeeded, 0 failed, 0 skipped");
  assert.deepEqual((await calls(directory))[0]?.slice(-4), [
    "--node-filter",
    "vm1",
    "--timeout",
    "10m"
  ]);
  await assert.rejects(localSaveSnapshots(options, topology, { timeout: "soon" }), { status: 400 });
});
