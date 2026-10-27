import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { findWireshark, launchLocalWireshark, wiresharkCandidates } from "./localWireshark.ts";

/**
 * A wireshark that writes its arguments and its stdin to files. With
 * FAKE_EXIT_AFTER it exits after reading that many bytes, like a closed window.
 */
const FAKE = String.raw`
const fs = require("node:fs");
const dir = process.env.FAKE_DIR;
fs.writeFileSync(dir + "/args.json", JSON.stringify(process.argv.slice(2)));
const out = fs.openSync(dir + "/stdin.bin", "w");
const exitAfter = Number(process.env.FAKE_EXIT_AFTER || 0);
let read = 0;
process.stdin.on("data", (chunk) => {
  fs.writeSync(out, chunk);
  read += chunk.length;
  if (exitAfter && read >= exitAfter) { fs.closeSync(out); process.exit(0); }
});
process.stdin.on("end", () => { fs.closeSync(out); fs.writeFileSync(dir + "/eof", ""); process.exit(0); });
`;

async function fakeWireshark(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-wireshark-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const binary = path.join(directory, "wireshark");
  await fs.writeFile(binary, `#!${process.execPath}\n${FAKE}`, { mode: 0o755 });
  return { directory, binary };
}

async function* chunks(parts: string[], delayMs = 0): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    yield new TextEncoder().encode(part);
  }
}

test("Wireshark gets -k -i -, the title, and the whole stream on stdin", async (t) => {
  const fake = await fakeWireshark(t);
  const session = await launchLocalWireshark(chunks(["SHB", "IDB", "EPB1", "EPB2"], 5), {
    binaryPath: fake.binary,
    title: "demo: n1:eth1, n2:eth1",
    env: { PATH: process.env.PATH, FAKE_DIR: fake.directory }
  });
  assert.equal(typeof session.pid, "number");
  await session.finished;
  assert.equal((await session.exited).code, 0);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(fake.directory, "args.json"), "utf8")), [
    "-k",
    "-i",
    "-",
    "-o",
    "gui.window_title:demo: n1:eth1, n2:eth1"
  ]);
  assert.equal(await fs.readFile(path.join(fake.directory, "stdin.bin"), "utf8"), "SHBIDBEPB1EPB2");
  // The stream's end closes Wireshark's stdin.
  await fs.access(path.join(fake.directory, "eof"));
});

test("a Wireshark that exits stops the capture and leaves the stream", async (t) => {
  const fake = await fakeWireshark(t);
  let stopped = 0;
  let returned = false;
  const controller = new AbortController();
  async function* endless(): AsyncGenerator<Uint8Array> {
    try {
      while (!controller.signal.aborted) {
        yield new Uint8Array(1024).fill(1);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    } finally {
      returned = true;
    }
  }
  const session = await launchLocalWireshark(endless(), {
    binaryPath: fake.binary,
    env: { PATH: process.env.PATH, FAKE_DIR: fake.directory, FAKE_EXIT_AFTER: "4096" },
    stopCapture: () => {
      stopped += 1;
      controller.abort();
    }
  });
  await session.exited;
  await session.finished;
  assert.equal(stopped, 1);
  assert.equal(returned, true);
});

test("stop() ends the capture and Wireshark keeps what it read", async (t) => {
  const fake = await fakeWireshark(t);
  const controller = new AbortController();
  async function* untilAborted(): AsyncGenerator<Uint8Array> {
    yield new TextEncoder().encode("HEAD");
    if (!controller.signal.aborted) {
      await new Promise((resolve) => controller.signal.addEventListener("abort", resolve, { once: true }));
    }
    yield new TextEncoder().encode("TAIL");
  }
  const session = await launchLocalWireshark(untilAborted(), {
    binaryPath: fake.binary,
    env: { PATH: process.env.PATH, FAKE_DIR: fake.directory },
    stopCapture: () => controller.abort()
  });
  session.stop();
  await session.finished;
  await session.exited;
  // The tail the capture wrote after the stop still reached Wireshark.
  assert.equal(await fs.readFile(path.join(fake.directory, "stdin.bin"), "utf8"), "HEADTAIL");
});

test("a missing Wireshark rejects with 503 and nothing is read", async () => {
  let read = false;
  async function* stream(): AsyncGenerator<Uint8Array> {
    read = true;
    yield new Uint8Array(1);
  }
  await assert.rejects(
    launchLocalWireshark(stream(), { env: { PATH: path.join(os.tmpdir(), "no-wireshark-here") }, platform: "linux" }),
    (error: Error & { status?: number }) => error.status === 503 && /Wireshark was not found/.test(error.message)
  );
  assert.equal(read, false);
});

test("Wireshark is found where each platform installs it", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "find-wireshark-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  assert.deepEqual(wiresharkCandidates({ platform: "darwin", env: { HOME: "/Users/u" } }), [
    "/Applications/Wireshark.app/Contents/MacOS/Wireshark",
    "/Users/u/Applications/Wireshark.app/Contents/MacOS/Wireshark"
  ]);
  assert.deepEqual(
    wiresharkCandidates({ platform: "win32", env: { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" } }),
    ["C:\\Program Files\\Wireshark\\Wireshark.exe", "C:\\Program Files (x86)\\Wireshark\\Wireshark.exe"]
  );
  assert.deepEqual(wiresharkCandidates({ platform: "linux", env: {} }), []);

  // Linux: PATH.
  const bin = path.join(root, "bin");
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, "wireshark"), "", { mode: 0o755 });
  assert.equal(await findWireshark(undefined, { platform: "linux", env: { PATH: `/missing:${bin}` } }), path.join(bin, "wireshark"));
  // A configured name or path wins; a configured path that is missing is not replaced by a guess.
  assert.equal(await findWireshark("wireshark", { platform: "linux", env: { PATH: bin } }), path.join(bin, "wireshark"));
  assert.equal(await findWireshark(path.join(root, "nope", "wireshark"), { platform: "linux", env: { PATH: bin } }), undefined);
  // macOS: the app bundle in the home folder.
  const bundle = path.join(root, "Applications/Wireshark.app/Contents/MacOS");
  await fs.mkdir(bundle, { recursive: true });
  await fs.writeFile(path.join(bundle, "Wireshark"), "");
  assert.equal(await findWireshark(undefined, { platform: "darwin", env: { HOME: root, PATH: "" } }), path.join(bundle, "Wireshark"));
});
