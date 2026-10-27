import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import type { CaptureGap } from "../contract/dto.ts";
import { c9sCaptureArgs, listC9sCaptureInterfaces, spawnC9sCapture } from "./c9sCapture.ts";

/**
 * A containerlab whose `capture` writes pcapng like the real one: an SHB and
 * an IDB, then packets. FAKE_MODE picks what it does; every signal it gets is
 * logged to FAKE_LOG.
 */
const FAKE = String.raw`
const fs = require("node:fs");
const mode = process.env.FAKE_MODE;
const log = (line) => fs.appendFileSync(process.env.FAKE_LOG, line + "\n");
log("args " + process.argv.slice(2).join(" "));
function block(type, body) {
  const padded = Math.ceil(body.length / 4) * 4;
  const length = 12 + padded;
  const buffer = Buffer.alloc(length);
  buffer.writeUInt32LE(type, 0);
  buffer.writeUInt32LE(length, 4);
  body.copy(buffer, 8);
  buffer.writeUInt32LE(length, length - 4);
  return buffer;
}
const shb = () => { const b = Buffer.alloc(16); b.writeUInt32LE(0x1a2b3c4d, 0); b.writeUInt16LE(1, 4); b.writeBigInt64LE(-1n, 8); return block(0x0a0d0d0a, b); };
const idb = () => { const b = Buffer.alloc(8); b.writeUInt16LE(1, 0); return block(1, b); };
let seq = 0;
const epb = (size = 64) => { const b = Buffer.alloc(20 + size); b.writeUInt32LE(0, 0); b.writeUInt32LE(size, 12); b.writeUInt32LE(size, 16); b.writeUInt32LE(seq++, 20); return block(6, b); };
if (process.argv.includes("--list")) {
  process.stdout.write('12:00:00 INFO noise\n[{"node":"n1","interface":"eth1","peer_node":"n2","peer_interface":"eth1"}]\n');
  process.exit(0);
}
if (mode === "fail") {
  process.stderr.write("12:00:00 ERRO interface eth9 of node n1 is not capturable; capturable: eth1\n");
  process.exit(1);
}
process.on("SIGTERM", () => { log("SIGTERM"); process.exit(143); });
if (mode === "ignore-int") {
  process.on("SIGINT", () => log("SIGINT"));
} else {
  process.on("SIGINT", () => {
    log("SIGINT");
    // Finish the file: a last packet, written whole, then exit 0 like containerlab.
    process.stdout.write(epb(), () => process.exit(0));
  });
}
process.stdout.write(Buffer.concat([shb(), idb()]));
if (mode === "gap") {
  process.stderr.write('12:00:01 WARN Capture has a gap node=n1 interfaces=eth1 from=2026-10-27T14:00:00Z to=2026-10-27T14:00:01Z reason="segment started late"\n');
  process.stdout.write(epb(), () => process.exit(0));
} else if (mode === "flood") {
  // 16 MiB as fast as the reader allows; FAKE_LOG says when the last write was accepted.
  let left = 16 * 1024;
  const next = () => {
    while (left > 0) {
      left -= 1;
      if (!process.stdout.write(epb(1000))) { process.stdout.once("drain", next); return; }
    }
    log("flooded " + Date.now());
    process.exit(0);
  };
  next();
} else if (mode === "die") {
  process.stdout.write(epb(), () => { process.stderr.write("12:00:02 ERRO pod n1 went away\n"); process.exit(1); });
} else {
  setInterval(() => process.stdout.write(epb()), 20);
}
`;

async function fakeContainerlab(t: TestContext) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "c9s-capture-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const binary = path.join(directory, "containerlab");
  await fs.writeFile(binary, `#!${process.execPath}\n${FAKE}`, { mode: 0o755 });
  const logFile = path.join(directory, "log");
  return {
    options: { binaryPath: binary, sudo: false },
    env: (mode: string) => ({ PATH: process.env.PATH, FAKE_MODE: mode, FAKE_LOG: logFile }),
    log: async () => (await fs.readFile(logFile, "utf8").catch(() => "")).trim().split("\n")
  };
}

function blockTypes(data: Uint8Array): number[] {
  const types: number[] = [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  while (offset + 12 <= data.byteLength) {
    types.push(view.getUint32(offset, true));
    const length = view.getUint32(offset + 4, true);
    assert.equal(view.getUint32(offset + length - 4, true), length, "block ends with its length");
    offset += length;
  }
  assert.equal(offset, data.byteLength, "no partial block");
  return types;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test("capture arguments name the lab, the targets per node and the limits, and write to stdout", () => {
  assert.deepEqual(
    c9sCaptureArgs({
      labName: "demo",
      targets: [
        { node: "n1", interface: "eth1" },
        { node: "n2", interface: "eth1" },
        { node: "n1", interface: "eth2" }
      ],
      duration: "5s",
      packetLimit: 100,
      snapLength: 256
    }),
    [
      "-r", "c9s", "capture", "--name", "demo",
      "--target", "n1:eth1,eth2", "--target", "n2:eth1",
      "--duration", "5s", "--packet-limit", "100", "--snap-length", "256",
      "-w", "-"
    ]
  );
  assert.deepEqual(c9sCaptureArgs({ labName: "demo", targets: [{ node: "n1", interface: "eth1" }] }), [
    "-r", "c9s", "capture", "--name", "demo", "--target", "n1:eth1", "-w", "-"
  ]);
  assert.throws(() => c9sCaptureArgs({ labName: "demo", targets: [], duration: "forever" }), /Invalid capture duration/);
});

test("capture --list output becomes capture interfaces", async (t) => {
  const fake = await fakeContainerlab(t);
  assert.deepEqual(await listC9sCaptureInterfaces(fake.options, "demo", fake.env("list")), [
    { node: "n1", interface: "eth1", peerNode: "n2", peerInterface: "eth1" }
  ]);
  assert.match((await fake.log())[0], /^args -r c9s capture --name demo --list -f json$/);
});

test("aborting a capture sends SIGINT once and the stream ends with whole blocks", async (t) => {
  const fake = await fakeContainerlab(t);
  const controller = new AbortController();
  const stream = await spawnC9sCapture(fake.options, ["-r", "c9s", "capture"], {
    env: fake.env("stream"),
    signal: controller.signal
  });
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
    if (chunks.length === 3) controller.abort();
  }
  const types = blockTypes(concat(chunks));
  assert.deepEqual(types.slice(0, 2), [0x0a0d0d0a, 1]);
  assert.ok(types.filter((type) => type === 6).length >= 2);
  const log = await fake.log();
  assert.deepEqual(log.filter((line) => /^SIG/.test(line)), ["SIGINT"]);
});

test("leaving the iteration early stops the capture with SIGINT", async (t) => {
  const fake = await fakeContainerlab(t);
  const stream = await spawnC9sCapture(fake.options, [], {
    env: fake.env("stream"),
    signal: new AbortController().signal
  });
  for await (const chunk of stream) {
    assert.ok(chunk.byteLength > 0);
    break;
  }
  await waitFor(async () => (await fake.log()).includes("SIGINT"));
});

test("a capture that ignores SIGINT gets SIGTERM after the grace time", async (t) => {
  const fake = await fakeContainerlab(t);
  const controller = new AbortController();
  const stream = await spawnC9sCapture(fake.options, [], {
    env: fake.env("ignore-int"),
    signal: controller.signal,
    stopGraceMs: 100
  });
  controller.abort();
  for await (const chunk of stream) assert.ok(chunk.byteLength > 0);
  assert.deepEqual((await fake.log()).filter((line) => /^SIG/.test(line)), ["SIGINT", "SIGTERM"]);
});

test("a capture is read only as fast as it is consumed", async (t) => {
  const fake = await fakeContainerlab(t);
  const stream = await spawnC9sCapture(fake.options, [], {
    env: fake.env("flood"),
    signal: new AbortController().signal
  });
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();
  // A slow consumer: the 16 MiB cannot all be written while nobody reads.
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal((await fake.log()).some((line) => line.startsWith("flooded")), false, "the writer was held back");
  let bytes = 0;
  while (true) {
    const next = await iterator.next();
    if (next.done) break;
    bytes += next.value.byteLength;
  }
  assert.ok(bytes > 16 * 1000 * 1024, `read ${bytes} bytes`);
  assert.ok((await fake.log()).some((line) => line.startsWith("flooded")));
});

test("a capture that cannot start rejects with containerlab's error", async (t) => {
  const fake = await fakeContainerlab(t);
  await assert.rejects(
    spawnC9sCapture(fake.options, [], { env: fake.env("fail"), signal: new AbortController().signal }),
    (error: Error & { status?: number }) => {
      assert.match(error.message, /eth9 of node n1 is not capturable; capturable: eth1/);
      assert.equal(error.status, 400);
      return true;
    }
  );
});

test("a capture that fails after it started ends its stream with the error", async (t) => {
  const fake = await fakeContainerlab(t);
  const stream = await spawnC9sCapture(fake.options, [], { env: fake.env("die"), signal: new AbortController().signal });
  const chunks: Uint8Array[] = [];
  await assert.rejects(
    (async () => {
      for await (const chunk of stream) chunks.push(chunk);
    })(),
    /pod n1 went away/
  );
  assert.deepEqual(blockTypes(concat(chunks)), [0x0a0d0d0a, 1, 6]);
});

test("a gap is reported and the capture goes on", async (t) => {
  const fake = await fakeContainerlab(t);
  const gaps: CaptureGap[] = [];
  const stream = await spawnC9sCapture(fake.options, [], {
    env: fake.env("gap"),
    signal: new AbortController().signal,
    onGap: (gap) => gaps.push(gap)
  });
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(blockTypes(concat(chunks)), [0x0a0d0d0a, 1, 6]);
  assert.deepEqual(gaps, [
    {
      node: "n1",
      interfaces: ["eth1"],
      from: "2026-10-27T14:00:00Z",
      to: "2026-10-27T14:00:01Z",
      reason: "segment started late"
    }
  ]);
});

test("a missing containerlab rejects with 503", async () => {
  await assert.rejects(
    spawnC9sCapture({ binaryPath: path.join(os.tmpdir(), "no-such-dir-c9s", "containerlab"), sudo: false }, [], {
      env: { PATH: process.env.PATH },
      signal: new AbortController().signal
    }),
    (error: Error & { status?: number }) => error.status === 503
  );
});
