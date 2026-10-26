import assert from "node:assert/strict";
import test from "node:test";

import { parseLogLine } from "./logHighlight";

test("the runtime timestamp is split off and levels and pairs are marked", () => {
  const parsed = parseLogLine(
    '2026-10-25T16:49:27.123456789Z time="2026-10-25" level=error msg="link down" ERROR again'
  );
  assert.equal(parsed.runtimeTimestamp, "2026-10-25T16:49:27.123456789Z");
  assert.deepEqual(
    parsed.segments.map((segment) => [segment.kind, segment.text]),
    [
      ["key", "time="],
      ["value", '"2026-10-25"'],
      ["text", " "],
      ["key", "level="],
      ["error", "error"],
      ["text", " "],
      ["key", "msg="],
      ["value", '"link down"'],
      ["text", " "],
      ["error", "ERROR"],
      ["text", " again"]
    ]
  );
});

test("a node's own timestamp and bracketed levels are marked, other words are text", () => {
  const parsed = parseLogLine("2026/10/25 16:49:27 [WARN] BGP peer 10.0.0.1 is TCP reachable");
  assert.equal(parsed.runtimeTimestamp, undefined);
  assert.deepEqual(
    parsed.segments.map((segment) => [segment.kind, segment.text]),
    [
      ["timestamp", "2026/10/25 16:49:27"],
      ["text", " "],
      ["warn", "[WARN]"],
      ["text", " BGP peer 10.0.0.1 is TCP reachable"]
    ]
  );
});

test("plain lines stay one text segment", () => {
  assert.deepEqual(parseLogLine("hello world").segments, [{ kind: "text", text: "hello world" }]);
});
