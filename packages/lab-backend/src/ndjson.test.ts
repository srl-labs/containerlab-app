import assert from "node:assert/strict";
import { test } from "node:test";

import { readJsonLines, readLines, withIdleTimeout } from "./ndjson.ts";

const encoder = new TextEncoder();

test("withIdleTimeout passes chunks through until the stream ends", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("one\n"));
      controller.enqueue(encoder.encode("\ntwo\n"));
      controller.close();
    }
  });
  const lines: string[] = [];
  for await (const line of readLines(withIdleTimeout(stream, 1000))) lines.push(line);
  assert.deepEqual(lines, ["one", "two"]);
});

test("withIdleTimeout fails and cancels a stream that goes silent", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("one\n"));
    },
    cancel() {
      cancelled = true;
    }
  });
  const lines: string[] = [];
  await assert.rejects(async () => {
    for await (const line of readLines(withIdleTimeout(stream, 20))) lines.push(line);
  }, /No data from the lab host/);
  assert.deepEqual(lines, ["one"]);
  assert.equal(cancelled, true);
});

test("a stream is read from the call on, not from the first read", () => {
  // undici cancels the body of a garbage-collected Response unless its stream is locked.
  const open = () => new ReadableStream<Uint8Array>({});
  const lines = open();
  readLines(lines);
  assert.equal(lines.locked, true, "readLines");
  const records = open();
  readJsonLines(records);
  assert.equal(records.locked, true, "readJsonLines");
  const idle = open();
  withIdleTimeout(idle, 1000);
  assert.equal(idle.locked, true, "withIdleTimeout");
});
