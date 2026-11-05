import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { fclingQueryString, isFclingApiCallAllowed, parseFclingEvents, type FclingEvent } from "./engine";

async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  for (const part of parts) yield encoder.encode(part);
}

async function events(...parts: string[]): Promise<FclingEvent[]> {
  const seen: FclingEvent[] = [];
  for await (const event of parseFclingEvents(chunks(...parts))) seen.push(event);
  return seen;
}

describe("isFclingApiCallAllowed", () => {
  test("offers what the Fabric view reads", () => {
    for (const path of [
      "status",
      "reports",
      "reports/bgp-peers",
      "reports/bgp-rib-evpn-2",
      "incidents",
      "history",
      "configs/diff",
      "lenses/path",
      "topology"
    ]) {
      assert.equal(isFclingApiCallAllowed("GET", path), true, path);
    }
  });

  test("offers only acknowledging and baselines for writing", () => {
    assert.equal(isFclingApiCallAllowed("POST", "acks"), true);
    assert.equal(isFclingApiCallAllowed("DELETE", "acks"), true);
    assert.equal(isFclingApiCallAllowed("POST", "baselines"), true);
    assert.equal(isFclingApiCallAllowed("DELETE", "baselines/pre-change"), true);
    assert.equal(isFclingApiCallAllowed("POST", "reports/bgp-peers"), false);
    assert.equal(isFclingApiCallAllowed("PUT", "acks"), false);
  });

  test("takes a name below a route as one plain segment", () => {
    assert.equal(isFclingApiCallAllowed("DELETE", "baselines/2026-10-18T14%3A02%3A11"), true);
    for (const path of [
      "reports/..",
      "reports/.",
      "reports/",
      "reports/a/b",
      "lenses/%2e%2e",
      "lenses/a%2Fb",
      "reports/%zz"
    ]) {
      assert.equal(isFclingApiCallAllowed("GET", path), false, path);
    }
    assert.equal(isFclingApiCallAllowed("DELETE", "baselines/.."), false);
    assert.equal(isFclingApiCallAllowed("DELETE", "baselines/%2e%2e"), false);
    assert.equal(isFclingApiCallAllowed("DELETE", "baselines/a%2Fchat"), false);
    assert.equal(isFclingApiCallAllowed("DELETE", "baselines"), false);
  });

  test("refuses chat, MCP and anything that climbs out of the API", () => {
    for (const method of ["GET", "POST", "DELETE"]) {
      for (const path of ["chat", "mcp", "../mcp", "reports/../chat", "openapi.json", "", "ui/app.js"]) {
        assert.equal(isFclingApiCallAllowed(method, path), false, `${method} ${path}`);
      }
    }
  });
});

describe("fclingQueryString", () => {
  test("repeats lists and leaves out what is not set", () => {
    assert.equal(
      fclingQueryString({ node: ["leaf1", "leaf2"], at: undefined, q: "", table: "1" }),
      "?node=leaf1&node=leaf2&table=1"
    );
    assert.equal(fclingQueryString(undefined), "");
    assert.equal(fclingQueryString({}), "");
  });
});

describe("parseFclingEvents", () => {
  test("reads events, whatever chunks they come in, and drops keep-alives", async () => {
    const parsed = await events(
      'event: status\ndata: {"type":"sta',
      'tus","nodes":[]}\n\n: keep-alive\n\nid: 7\nevent: change\n',
      'data: {"type":"change","seq":7}\n\n'
    );
    assert.deepEqual(parsed, [
      { type: "status", nodes: [] },
      { type: "change", seq: 7 }
    ]);
  });

  test("skips what is not an event of the engine", async () => {
    assert.deepEqual(await events('data: not json\n\ndata: {"no":"type"}\n\ndata: [1]\n\n'), []);
  });

  test("ends with the message of a stream that failed", async () => {
    await assert.rejects(events('event: error\ndata: {"error":"engine went away"}\n\n'), /engine went away/);
  });
});
