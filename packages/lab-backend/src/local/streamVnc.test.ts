import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import type Docker from "dockerode";

import type { CaptureNodeTarget } from "../capture.ts";
import { LocalCapture } from "./capture.ts";
import { resolveLocalOptions } from "./options.ts";

/**
 * Docker on this machine for the Wireshark VNC containers of a c9s host: it
 * logs its calls, names a container after its `--name`, and runs `exec -i`
 * scripts here with a named pipe per container in CLABWIRE_CAPTURE_PIPE.
 */
async function fakeDocker(t: TestContext, options: { pipeMode?: boolean } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stream-vnc-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const bin = path.join(dir, "bin");
  const pipes = path.join(dir, "pipes");
  await fs.mkdir(bin);
  await fs.mkdir(pipes);
  const log = path.join(dir, "calls.log");
  await fs.writeFile(
    path.join(bin, "docker"),
    `#!/bin/sh
echo "$*" >> "${log}"
case "$1" in
  version) echo 27.0.0 ;;
  run) while [ "$1" != "--name" ]; do shift; done; echo "$2" ;;
  exec)
    if [ "$2" = "-i" ]; then
      p="${pipes}/$3"
      [ -p "$p" ] || mkfifo "$p"
      CLABWIRE_CAPTURE_PIPE="$p" exec sh -c "$6"
    fi
    ${options.pipeMode === false ? "exit 1" : "exit 0"} ;;
esac
`,
    { mode: 0o755 }
  );
  const capture = new LocalCapture(
    resolveLocalOptions({ runtime: "c9s", env: { PATH: `${bin}:/usr/bin:/bin` }, wiresharkImage: "wireshark-vnc:test" }),
    () => ({}) as Docker
  );
  t.after(() => capture.dispose());
  return {
    capture,
    calls: async () => (await fs.readFile(log, "utf8").catch(() => "")).trim().split("\n"),
    /** Reads the pipe of the container whose name has `node`, like its Wireshark. */
    async read(node: string): Promise<{ text: () => string; stop: () => void }> {
      let name: string | undefined;
      for (let attempt = 0; attempt < 300 && !name; attempt++) {
        name = (await fs.readdir(pipes)).find((entry) => entry.includes(node));
        if (!name) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(name, `a pipe for ${node}`);
      const reader = spawn("cat", [path.join(pipes, name)], { stdio: ["ignore", "pipe", "ignore"] });
      let text = "";
      reader.stdout.setEncoding("utf8");
      reader.stdout.on("data", (chunk: string) => (text += chunk));
      return { text: () => text, stop: () => reader.kill("SIGKILL") };
    }
  };
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300 && !check(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check(), what);
}

const TARGETS: CaptureNodeTarget[] = [
  { node: "n1", interface: "eth1" },
  { node: "n1", interface: "eth2" },
  { node: "n2", interface: "eth1" }
];

test("cluster Wireshark VNC reads one capture per node through a pipe, until the session closes", async (t) => {
  const docker = await fakeDocker(t);
  const opened: { targets: string[]; aborted: boolean }[] = [];
  const { sessions } = await docker.capture.createStreamVnc(
    "demo",
    TARGETS,
    (targets, signal) => {
      const capture = { targets: targets.map((target) => `${target.node}:${target.interface}`), aborted: false };
      opened.push(capture);
      return Promise.resolve(
        (async function* () {
          while (!signal.aborted) {
            yield new TextEncoder().encode(`${capture.targets.join(",")};`);
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          capture.aborted = true;
        })()
      );
    },
    "dark"
  );
  assert.deepEqual(
    sessions.map((session) => [session.containerName, session.interfaceNames]),
    [
      ["demo-n1", ["eth1", "eth2"]],
      ["demo-n2", ["eth1"]]
    ]
  );
  const runs = (await docker.calls()).filter((call) => call.startsWith("run "));
  assert.equal(runs.length, 2);
  assert.match(runs[0], / -e CLABWIRE_CAPTURE_PIPE=\/tmp\/clabwire\/demo-n1 -e DARK_MODE=1 wireshark-vnc:test$/);
  assert.ok(runs.every((call) => !call.includes("PACKETFLIX_LINK")), "no Packetflix link");
  // Nothing captures until Wireshark opens the pipe; then the node's interfaces, in one capture.
  assert.equal(opened.length, 0);
  const n1 = await docker.read("demo-n1");
  await until(() => n1.text().includes("n1:eth1,n1:eth2;"), "Wireshark of n1 reads its capture");
  assert.deepEqual(opened.map((capture) => capture.targets), [["n1:eth1", "n1:eth2"]]);

  await docker.capture.closeVnc(sessions[0].sessionId);
  await until(() => opened[0].aborted, "closing the session ends its capture");
  assert.ok((await docker.calls()).some((call) => call === `rm -f ${runs[0].split(" ")[4]}`), "its container goes");
  n1.stop();
  await assert.rejects(docker.capture.vncReady(sessions[0].sessionId), (error: Error & { status?: number }) => error.status === 404);
});

test("an image without the capture pipe is refused, and its container removed", async (t) => {
  const docker = await fakeDocker(t, { pipeMode: false });
  await assert.rejects(
    docker.capture.createStreamVnc("demo", TARGETS.slice(0, 1), () => Promise.reject(new Error("not opened"))),
    (error: Error & { status?: number }) =>
      error.status === 501 && /wireshark-vnc:test has no capture pipe \(CLABWIRE_CAPTURE_PIPE\)/.test(error.message)
  );
  const calls = await docker.calls();
  assert.ok(calls.some((call) => call.startsWith("rm -f clab_ws_vnc_")), calls.join("\n"));
});
