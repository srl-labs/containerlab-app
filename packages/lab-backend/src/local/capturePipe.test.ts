import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { CAPTURE_PIPE_SCRIPT, capturePipePath, feedCapturePipe, type OpenPipeCapture } from "./capturePipe.ts";

/**
 * A named pipe like the Wireshark VNC image creates, and a runtime CLI whose
 * `exec -i <id> sh -c <script>` runs the script here with the pipe in
 * CLABWIRE_CAPTURE_PIPE.
 */
async function fakeContainer(t: TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "capture-pipe-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const pipe = path.join(dir, "pipe");
  execFileSync("mkfifo", [pipe]);
  const runtime = path.join(dir, "runtime");
  await fs.writeFile(
    runtime,
    '#!/bin/sh\n[ "$1 $2 $3 $4 $5" = "exec -i ctr sh -c" ] || exit 64\nCLABWIRE_CAPTURE_PIPE="$FAKE_PIPE" exec sh -c "$6"\n',
    { mode: 0o755 }
  );
  return { runtime, pipe, env: { ...process.env, FAKE_PIPE: pipe } };
}

/** Wireshark reading the pipe: everything it read once the writer closes, or until stopped. */
function readPipe(pipe: string) {
  const reader = spawn("cat", [pipe], { stdio: ["ignore", "pipe", "ignore"] });
  let text = "";
  reader.stdout.setEncoding("utf8");
  reader.stdout.on("data", (chunk: string) => (text += chunk));
  const closed = new Promise<string>((resolve) => reader.once("close", () => resolve(text)));
  return { text: () => text, closed, stop: () => reader.kill("SIGKILL") };
}

/** A capture that writes its name every 20 ms until its signal aborts; `ends` ends it by itself, `fails` throws. */
function captures(behaviour: { ends?: boolean; fails?: string } = {}) {
  const opened: { name: string; aborted: boolean }[] = [];
  const open: OpenPipeCapture = (signal) => {
    const capture = { name: `capture${opened.length + 1}`, aborted: false };
    opened.push(capture);
    return Promise.resolve(
      (async function* () {
        yield new TextEncoder().encode(`${capture.name};`);
        if (behaviour.ends === true) return;
        if (behaviour.fails !== undefined) throw new Error(behaviour.fails);
        while (!signal.aborted) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          yield new TextEncoder().encode(`${capture.name};`);
        }
        capture.aborted = true;
      })()
    );
  };
  return { opened, open };
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 300 && !check(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check(), what);
}

test("the pipe is named after the container, as Wireshark shows it", () => {
  assert.equal(capturePipePath("demo-n1"), "/tmp/clabwire/demo-n1");
  assert.equal(capturePipePath("lab/odd name"), "/tmp/clabwire/lab-odd-name");
  assert.equal(capturePipePath(".."), "/tmp/clabwire/capture");
  assert.match(CAPTURE_PIPE_SCRIPT, /CLABWIRE_CAPTURE_PIPE/);
});

test("a capture starts when Wireshark opens the pipe, and again when it reopens it", async (t) => {
  const { runtime, pipe, env } = await fakeContainer(t);
  const { opened, open } = captures();
  const feed = feedCapturePipe({ runtime, containerId: "ctr", env, open, retryDelayMs: 10 });
  // Nothing is captured before Wireshark reads.
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(opened.length, 0);

  const first = readPipe(pipe);
  await until(() => first.text().includes("capture1;capture1;"), "Wireshark reads the first capture");
  // Wireshark stops its capture: the pipe closes, so does the capture.
  first.stop();
  await until(() => opened[0].aborted, "the first capture stops with the pipe");

  const second = readPipe(pipe);
  await until(() => second.text().includes("capture2;"), "a restarted capture reads a new one");
  feed.stop();
  assert.equal(await feed.done, undefined);
  await until(() => opened[1].aborted, "stopping the feed stops its capture");
  second.stop();
  assert.equal(opened.length, 2);
});

test("a capture that ends by itself closes the pipe, so Wireshark reads to its end", async (t) => {
  const { runtime, pipe, env } = await fakeContainer(t);
  const { open } = captures({ ends: true });
  const feed = feedCapturePipe({ runtime, containerId: "ctr", env, open, retryDelayMs: 10 });
  const reader = readPipe(pipe);
  assert.equal(await reader.closed, "capture1;");
  feed.stop();
  assert.equal(await feed.done, undefined);
});

test("a capture that fails ends the feed with its error", async (t) => {
  const { runtime, pipe, env } = await fakeContainer(t);
  const { open } = captures({ fails: "the pod went away" });
  const feed = feedCapturePipe({ runtime, containerId: "ctr", env, open, retryDelayMs: 10 });
  const reader = readPipe(pipe);
  const error = await feed.done;
  assert.equal(error?.message, "the pod went away");
  reader.stop();
});

test("an exec that cannot write into the container ends the feed with its output", async (t) => {
  const { open, opened } = captures();
  const { env } = await fakeContainer(t);
  const feed = feedCapturePipe({ runtime: "false", containerId: "ctr", env, open, retryDelayMs: 10 });
  const error = await feed.done;
  assert.match(error?.message ?? "", /exec into the Wireshark container ended \(exit 1\)/);
  assert.equal(opened.length, 0);
});
