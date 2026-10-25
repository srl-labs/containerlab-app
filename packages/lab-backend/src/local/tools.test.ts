import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { LocalLabBackend } from "./localLabBackend.ts";
import { generateArgs, validationError } from "./tools.ts";

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lab-backend-tools-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

/** A `containerlab` stand-in that records its arguments and prints to stdout and stderr. */
async function fakeContainerlab(
  directory: string,
  output: { stdout?: string; stderr?: string; exitCode?: number; script?: string }
): Promise<string> {
  const binary = path.join(directory, "containerlab");
  await fs.writeFile(
    binary,
    [
      "#!/bin/sh",
      `printf '%s\\n' "$@" > "${directory}/args"`,
      output.script ?? "",
      `cat <<'OUT'\n${output.stdout ?? ""}\nOUT`,
      `cat <<'ERR' >&2\n${output.stderr ?? ""}\nERR`,
      `exit ${output.exitCode ?? 0}`
    ].join("\n"),
    { mode: 0o755 }
  );
  return binary;
}

async function recordedArgs(directory: string): Promise<string[]> {
  return (await fs.readFile(path.join(directory, "args"), "utf8")).trim().split("\n");
}

async function labWithTopology(t: TestContext) {
  const root = await temporaryDirectory(t);
  await fs.mkdir(path.join(root, "lab1"));
  const topology = path.join(root, "lab1", "lab1.clab.yml");
  await fs.writeFile(topology, "name: lab1\ntopology:\n  nodes: {}\n");
  return { root, topology };
}

test("validate reports containerlab's counts for a valid topology", async (t) => {
  const { root, topology } = await labWithTopology(t);
  const binary = await fakeContainerlab(root, {
    stderr: "12:00:00 INFO Topology is valid name=lab1 nodes=2 links=1"
  });
  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: binary });

  const result = await backend.validate({ labName: "lab1", path: "lab1/lab1.clab.yml" });

  assert.deepEqual(result, { valid: true, path: topology, labName: "lab1", nodes: 2, links: 1 });
  assert.deepEqual(await recordedArgs(root), ["validate", "-r", "docker", "-t", topology]);
});

test("validate turns a rejected topology into a result with containerlab's error", async (t) => {
  const { root } = await labWithTopology(t);
  const binary = await fakeContainerlab(root, {
    stderr: '12:00:00 ERRO node "n1" references unknown kind "nope"',
    exitCode: 1
  });
  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: binary });

  const result = await backend.validate({ labName: "lab1", path: "lab1/lab1.clab.yml" });

  assert.equal(result.valid, false);
  assert.equal(result.error, 'node "n1" references unknown kind "nope"');
});

test("validate asks for a newer containerlab when the command is missing", async (t) => {
  const { root } = await labWithTopology(t);
  const binary = await fakeContainerlab(root, {
    stderr: 'Error: unknown command "validate" for "containerlab"',
    exitCode: 1
  });
  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: binary });

  await assert.rejects(backend.validate({ labName: "lab1", path: "lab1/lab1.clab.yml" }), {
    status: 501
  });
});

test("validation errors fall back to cobra's Error line", () => {
  assert.equal(validationError("noise\nError: topology file is empty\n"), "topology file is empty");
});

test("graph exports read the file containerlab wrote into the lab directory", async (t) => {
  const { root, topology } = await labWithTopology(t);
  const graphFile = path.join(root, "lab1", "clab-lab1", "graph", "lab1.clab.mermaid");
  const binary = await fakeContainerlab(root, {
    script: `mkdir -p "${path.dirname(graphFile)}" && printf 'graph LR\\n  a---b\\n' > "${graphFile}"`,
    stderr: `12:00:00 INFO Created mermaid diagram file: ${graphFile}`
  });
  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: binary });

  const result = await backend.graphExport({ labName: "lab1", path: "lab1/lab1.clab.yml" }, "mermaid", {
    direction: "LR"
  });

  assert.equal(result.fileName, "lab1.clab.mermaid");
  assert.equal(result.content, "graph LR\n  a---b\n");
  assert.equal(result.direction, "LR");
  assert.deepEqual(await recordedArgs(root), [
    "graph",
    "-r",
    "docker",
    "--mermaid",
    "--mermaid-direction",
    "LR",
    "-t",
    topology
  ]);
});

test("dot exports find the file from the topology name when the log does not say", async (t) => {
  const { root } = await labWithTopology(t);
  const graphFile = path.join(root, "lab1", "clab-lab1", "graph", "lab1.clab.dot");
  const binary = await fakeContainerlab(root, {
    script: `mkdir -p "${path.dirname(graphFile)}" && printf 'graph "lab1" {}\\n' > "${graphFile}"`
  });
  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: binary });

  const result = await backend.graphExport({ labName: "lab1", path: "lab1/lab1.clab.yml" }, "dot");

  assert.deepEqual([result.fileName, result.format, result.content], ["lab1.clab.dot", "dot", 'graph "lab1" {}\n']);
});

test("generate builds containerlab's Clos flags", () => {
  assert.deepEqual(
    generateArgs({
      name: "clos",
      defaultKind: "nokia_srlinux",
      tiers: [{ count: 4, type: "ixrd3" }, { count: 2, kind: "linux" }],
      images: { nokia_srlinux: "ghcr.io/nokia/srlinux:latest", linux: " alpine " },
      licenses: { nokia_srlinux: "" },
      nodePrefix: "leaf",
      groupPrefix: "",
      ipv4Subnet: "172.20.30.0/24"
    }),
    [
      "generate",
      "--name",
      "clos",
      "--kind",
      "nokia_srlinux",
      "--nodes",
      "4:nokia_srlinux:ixrd3,2:linux",
      "--image",
      "nokia_srlinux=ghcr.io/nokia/srlinux:latest,linux=alpine",
      "--node-prefix",
      "leaf",
      "--ipv4-subnet",
      "172.20.30.0/24"
    ]
  );
});

test("generate returns the topology containerlab prints", async (t) => {
  const root = await temporaryDirectory(t);
  const binary = await fakeContainerlab(root, {
    stdout: "name: clos\ntopology:\n  nodes: {}",
    stderr: "12:00:00 DEBU parsed nodes"
  });
  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: binary });

  const result = await backend.generateTopology({ name: "clos", tiers: [{ count: 2 }], images: {} });
  assert.equal(result.topologyYaml?.trim(), "name: clos\ntopology:\n  nodes: {}");

  await assert.rejects(backend.generateTopology({ name: "bad name", tiers: [{ count: 1 }], images: {} }), {
    status: 400
  });
  await assert.rejects(backend.generateTopology({ name: "clos", tiers: [{ count: 0 }], images: {} }), {
    status: 400
  });
});

test("sshx with readers returns the full and the read-only link", async (t) => {
  const root = await temporaryDirectory(t);
  const binary = await fakeContainerlab(root, {
    stdout: "Read-only access link:\nhttps://sshx.io/s/abc#read",
    stderr: "12:00:00 INFO SSHX successfully started link=https://sshx.io/s/abc#read,write"
  });
  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: binary });

  const result = await backend.shareTool("sshx", "lab1", "attach", { enableReaders: true });

  assert.equal(result.link, "https://sshx.io/s/abc#read,write");
  assert.equal(result.readOnlyLink, "https://sshx.io/s/abc#read");
  assert.deepEqual(await recordedArgs(root), ["tools", "sshx", "attach", "-l", "lab1", "--enable-readers"]);
});

test("GoTTY passes credentials and shell, and keeps the password out of errors", async (t) => {
  const root = await temporaryDirectory(t);
  const binary = await fakeContainerlab(root, { stdout: "http://HOST_IP:8081" });
  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: binary });

  const result = await backend.shareTool("gotty", "lab1", "attach", {
    port: 8081,
    username: "lab",
    password: "S3cret",
    shell: "sh"
  });
  assert.deepEqual([result.link, result.username, result.shell], ["http://HOST_IP:8081", "lab", "sh"]);
  assert.deepEqual(await recordedArgs(root), [
    "tools",
    "gotty",
    "attach",
    "-l",
    "lab1",
    "--port",
    "8081",
    "--username",
    "lab",
    "--password",
    "S3cret",
    "--shell",
    "sh"
  ]);

  await assert.rejects(backend.shareTool("gotty", "lab1", "attach", { username: "lab", password: "$(id)" }), {
    status: 400
  });

  const failing = await fakeContainerlab(root, { stderr: "12:00:00 ERRO bad password S3cret", exitCode: 1 });
  const failingBackend = new LocalLabBackend({ workspaceRoot: root, binaryPath: failing });
  await assert.rejects(
    failingBackend.shareTool("gotty", "lab1", "attach", { username: "lab", password: "S3cret" }),
    (error: Error) => !error.message.includes("S3cret") && error.message.includes("***")
  );
});
