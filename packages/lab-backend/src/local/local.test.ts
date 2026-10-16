import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import type { LifecycleStreamEvent } from "../contract/backend.ts";
import {
  filterLifecycleLine,
  groupCaptureTargets,
  LocalLabBackend,
  packetflixUri,
  parseRepositoryUrl,
  prepareEdgesharkCompose,
  terminalShellCommand,
  terminalSshUsername,
  toApplyLabResponse
} from "./index.ts";
import { lifecycleLineStream } from "./lifecycle.ts";
import { containerlabCommand } from "./process.ts";

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lab-backend-local-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

/** A `containerlab` stand-in that records its arguments and prints `output`. */
async function fakeContainerlab(directory: string, output: string, exitCode = 0): Promise<string> {
  const script = path.join(directory, "containerlab");
  await fs.writeFile(
    script,
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${directory}/args"\ncat <<'OUT' >&2\n${output}\nOUT\nexit ${exitCode}\n`,
    { mode: 0o755 }
  );
  return script;
}

async function collect(events: AsyncIterable<LifecycleStreamEvent>): Promise<LifecycleStreamEvent[]> {
  const result: LifecycleStreamEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

test("lifecycle output keeps log records and tables, without ANSI or usernames", () => {
  assert.equal(filterLifecycleLine("\x1b[1m21:07:59 INFO Creating lab\x1b[0m"), "21:07:59 INFO Creating lab");
  assert.equal(filterLifecycleLine("│ clab-a │ linux │"), "│ clab-a │ linux │");
  assert.equal(filterLifecycleLine("21:07:59 INFO login username=alice"), undefined);
  assert.equal(filterLifecycleLine("progress bar noise"), undefined);
  assert.equal(filterLifecycleLine("   "), undefined);
  assert.equal(lifecycleLineStream("21:07:59 ERROR deploy failed"), "stderr");
  assert.equal(lifecycleLineStream("21:07:59 ERRO deploy failed"), "stdout");
});

test("apply plans become clab-api-server ApplyLabResponse objects", () => {
  assert.deepEqual(
    toApplyLabResponse(
      { "dry-run": true, "added-nodes": ["n3"], "recreated-nodes": null, "node-change-reasons": { n1: "image" } },
      "lab1",
      true
    ),
    {
      dryRun: true,
      deployedLab: false,
      labName: "lab1",
      addedNodes: ["n3"],
      deletedNodes: [],
      recreatedNodes: [],
      startedNodes: [],
      addedLinks: [],
      deletedEndpoints: [],
      restartedNodes: [],
      nodeChangeReasons: { n1: "image" }
    }
  );
});

test("capture targets group per container, with host link ends in the host namespace", () => {
  const groups = groupCaptureTargets([
    { containerName: "clab-l-a", interfaceName: "eth1" },
    { containerName: "clab-l-a", interfaceName: "eth2" },
    { containerName: "clab-l-a", interfaceName: "eth1" },
    { containerName: "clab-l-b", interfaceName: "clab-s-1" }
  ]);
  assert.deepEqual(groups, [
    { containerName: "clab-l-a", interfaceNames: ["eth1", "eth2"], hostNamespace: false },
    { containerName: "clab-l-b", interfaceNames: ["clab-s-1"], hostNamespace: true }
  ]);
  assert.equal(
    packetflixUri("localhost", 5001, groups[0]),
    "packetflix:ws://localhost:5001/capture?container=%7B%22name%22%3A%22clab-l-a%22%2C%22network-interfaces%22%3A%5B%22eth1%22%2C%22eth2%22%5D%2C%22type%22%3A%22docker%22%7D&nif=eth1%2Feth2"
  );
  assert.match(packetflixUri("::1", 5001, groups[1], 4026531840), /^packetflix:ws:\/\/\[::1\]:5001\/capture\?container=%7B%22netns%22%3A4026531840/);
});

test("the Edgeshark compose file uses the bare gostwire name and gets extra variables", () => {
  const compose = [
    "services:",
    "    gostwire:",
    "        image: 'ghcr.io/siemens/ghostwire'",
    "        pull_policy: always",
    "    edgeshark:",
    "        pull_policy: 'always'",
    '        - "--discovery-service=gostwire.ghost-in-da-edge"'
  ].join("\n");
  const prepared = prepareEdgesharkCompose(compose, ["HTTP_PROXY="]);
  assert.match(prepared, /--discovery-service=gostwire"/);
  assert.equal(prepared.match(/ {8}environment:\n {10}- HTTP_PROXY=/g)?.length, 2);
  assert.equal(prepareEdgesharkCompose(compose, []).includes("environment"), false);
});

test("repository URLs name the lab and the branch", () => {
  assert.deepEqual(parseRepositoryUrl("srl-labs/srlinux-vlan-handling-lab"), {
    name: "srlinux-vlan-handling-lab",
    cloneUrl: "https://github.com/srl-labs/srlinux-vlan-handling-lab.git"
  });
  assert.deepEqual(parseRepositoryUrl("https://github.com/org/repo/tree/dev/labs/a.clab.yml"), {
    name: "repo",
    cloneUrl: "https://github.com/org/repo.git",
    branch: "dev",
    subPath: "labs/a.clab.yml"
  });
  assert.deepEqual(parseRepositoryUrl("https://gitlab.com/group/sub/repo.git"), {
    name: "repo",
    cloneUrl: "https://gitlab.com/group/sub/repo.git"
  });
  assert.throws(() => parseRepositoryUrl("https://example.com/repo"), /GitHub and GitLab/);
});

test("terminals open the kind's shell and SSH user", () => {
  assert.deepEqual(terminalShellCommand("nokia_srlinux"), ["sr_cli"]);
  assert.deepEqual(terminalShellCommand("linux"), ["sh"]);
  assert.equal(terminalSshUsername("cisco_xrd"), "clab");
  assert.equal(terminalSshUsername("nokia_srlinux"), "admin");
  assert.equal(terminalSshUsername("nokia_srlinux", "ops"), "ops");
  assert.equal(terminalSshUsername("linux", "bad name"), "admin");
});

test("sudo runs containerlab without prompting", () => {
  assert.deepEqual(containerlabCommand({ binaryPath: "clab", sudo: true }, ["inspect"]), [
    "sudo",
    ["-n", "clab", "inspect"]
  ]);
  assert.deepEqual(containerlabCommand({ binaryPath: "clab", sudo: false }, ["inspect"]), ["clab", ["inspect"]]);
});

test("topologies are named like clab-api-server names them", async (t) => {
  const root = await temporaryDirectory(t);
  const write = async (relative: string, content = "name: declared\n") => {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), content);
  };
  await write("root.clab.yml");
  await write("lab1/lab1.clab.yml");
  await write("lab1/lab1.clab.yml.annotations.json", "{}");
  await write("multi/a.clab.yml", "name: alpha\n");
  await write("multi/b.clab.yaml", "name: not valid!\n");
  await write("deep/x/y.clab.yml", "name: deep-lab\n");
  await write("lab1/clab-lab1/topology-data.json", "{}");
  await write("lab1/clab-lab1/inner.clab.yml");
  await write(".hidden/h.clab.yml");
  await write("node_modules/n.clab.yml");

  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: "/nonexistent/containerlab" });
  const entries = await backend.listTopologies();
  assert.deepEqual(
    entries.map((entry) => [entry.labName, entry.yamlFileName, entry.hasAnnotations]),
    [
      ["alpha", "multi/a.clab.yml", false],
      ["b", "multi/b.clab.yaml", false],
      ["deep-lab", "deep/x/y.clab.yml", false],
      ["lab1", "lab1/lab1.clab.yml", true],
      ["root", "root.clab.yml", false]
    ]
  );

  const files = backend.topologyFiles({ labName: "lab1", yamlPath: "lab1/lab1.clab.yml" });
  assert.equal(await files.readFile("lab1/lab1.clab.yml"), "name: declared\n");
  // A legacy path relative to the lab folder resolves to the same file.
  assert.equal(await files.readFile("lab1.clab.yml"), "name: declared\n");
  await assert.rejects(files.readFile("../../etc/passwd"), /invalid file path/);
});

test("lifecycle streams filtered containerlab output and ends with done", async (t) => {
  const root = await temporaryDirectory(t);
  await fs.mkdir(path.join(root, "lab1"));
  await fs.writeFile(path.join(root, "lab1", "lab1.clab.yml"), "name: lab1\n");
  const binary = await fakeContainerlab(root, "21:00:00 INFO Creating lab\nnoise\n╭──╮");
  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: binary, runtime: "podman" });

  const events = await collect(
    await backend.streamLifecycle(
      "deploy",
      { labName: "lab1", path: "lab1/lab1.clab.yml" },
      { cleanup: true, lifecycleOptions: { nodeFilter: ["n1"], skipPostDeploy: true } }
    )
  );
  assert.deepEqual(events, [
    { type: "log", line: "21:00:00 INFO Creating lab", stream: "stdout" },
    { type: "log", line: "╭──╮", stream: "stdout" },
    { type: "done" }
  ]);
  const args = (await fs.readFile(path.join(root, "args"), "utf8")).trim().split("\n");
  assert.deepEqual(args, [
    "deploy",
    "-r",
    "podman",
    "--reconfigure",
    "--name",
    "lab1",
    "--node-filter",
    "n1",
    "--skip-post-deploy",
    "-t",
    path.join(root, "lab1", "lab1.clab.yml")
  ]);
});

test("a failed lifecycle action ends with containerlab's error", async (t) => {
  const root = await temporaryDirectory(t);
  await fs.writeFile(path.join(root, "lab2.clab.yml"), "name: lab2\n");
  const binary = await fakeContainerlab(root, "21:00:00 ERRO image pull failed", 1);
  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: binary });

  const events = await collect(
    await backend.streamLifecycle("deploy", { labName: "lab2", path: "lab2.clab.yml" })
  );
  assert.deepEqual(events.at(-1), { type: "error", error: "Failed to deploy lab 'lab2': image pull failed" });

  await assert.rejects(
    backend.streamLifecycle("deploy", { labName: "lab2", path: "missing.clab.yml" }),
    (error: unknown) => (error as { status?: number }).status === 404
  );
});

test("a lab runs one lifecycle action at a time", async (t) => {
  const root = await temporaryDirectory(t);
  await fs.writeFile(path.join(root, "lab3.clab.yml"), "name: lab3\n");
  const binary = await fakeContainerlab(root, "21:00:00 INFO ok");
  const backend = new LocalLabBackend({ workspaceRoot: root, binaryPath: binary });
  const first = await backend.streamLifecycle("deploy", { labName: "lab3", path: "lab3.clab.yml" });
  await assert.rejects(
    backend.streamLifecycle("deploy", { labName: "lab3", path: "lab3.clab.yml" }),
    (error: unknown) => (error as { status?: number }).status === 409
  );
  await collect(first);
  await collect(await backend.streamLifecycle("deploy", { labName: "lab3", path: "lab3.clab.yml" }));
});
