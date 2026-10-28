import assert from "node:assert/strict";
import test from "node:test";

import WebSocket from "ws";

import type { CaptureNodeTarget } from "../capture.ts";
import { PacketflixTicketServer, selectGrantedTargets, splitGrantedNames } from "./packetflixServer.ts";

const TARGETS: CaptureNodeTarget[] = [
  { node: "sros", interface: "1/1/3" },
  { node: "sros", interface: "1/1/4" }
];

function linkUrl(packetflixUri: string, suffix = ""): string {
  const url = new URL(packetflixUri.replace(/^packetflix:/, ""));
  return `ws://${url.host}${url.pathname}${suffix}${url.search}`;
}

function server(): PacketflixTicketServer {
  return new PacketflixTicketServer(() => Promise.resolve({ bind: "127.0.0.1", urlHost: "127.0.0.1" }));
}

/** A capture that yields `blocks`, then waits until its signal aborts. */
function endlessCapture(blocks: string[], opened: { targets?: CaptureNodeTarget[]; aborted?: boolean }) {
  return (targets: CaptureNodeTarget[], signal: AbortSignal): Promise<AsyncIterable<Uint8Array>> => {
    opened.targets = targets;
    return Promise.resolve(
      (async function* () {
        for (const block of blocks) yield new TextEncoder().encode(block);
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
        opened.aborted = true;
      })()
    );
  };
}

function connect(url: string): Promise<{ messages: string[]; closed: Promise<{ code: number; reason: string }>; socket: WebSocket }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const messages: string[] = [];
    const closed = new Promise<{ code: number; reason: string }>((done) =>
      socket.once("close", (code, reason) => done({ code, reason: reason.toString() }))
    );
    socket.on("message", (data) => messages.push(String(data)));
    socket.once("open", () => resolve({ messages, closed, socket }));
    socket.once("unexpected-response", (_request, response) => reject(new Error(`HTTP ${response.statusCode}`)));
    socket.once("error", reject);
  });
}

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !check(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(check());
}

test("interface names that contain slashes are split along the granted names", () => {
  const granted = new Set(["sros:1/1/3", "sros:1/1/4", "srl:e1-1"]);
  assert.deepEqual(splitGrantedNames("sros:1/1/3/srl:e1-1", granted), ["sros:1/1/3", "srl:e1-1"]);
  assert.equal(splitGrantedNames("sros:1/1/5", granted), undefined);
});

test("a request captures the nif names, or every granted target; other names are refused", () => {
  const at = (query: string) => new URL(`ws://h/packetflix/t${query}`);
  assert.deepEqual(selectGrantedTargets(at(""), {}, TARGETS), TARGETS);
  assert.deepEqual(selectGrantedTargets(at("?nif=all"), {}, TARGETS), TARGETS);
  assert.deepEqual(selectGrantedTargets(at(`?nif=${encodeURIComponent("sros:1/1/4")}`), {}, TARGETS), [TARGETS[1]]);
  assert.deepEqual(selectGrantedTargets(at(""), { "clustershark-nif": "sros:1/1/3" }, TARGETS), [TARGETS[0]]);
  assert.equal(selectGrantedTargets(at("?nif=sros:1/1/9"), {}, TARGETS), undefined);
  const container = (names: string[]) => `?container=${encodeURIComponent(JSON.stringify({ "network-interfaces": names }))}`;
  assert.deepEqual(selectGrantedTargets(at(container(["sros:1/1/3"])), {}, TARGETS), TARGETS);
  assert.equal(selectGrantedTargets(at(container(["other:eth1"])), {}, TARGETS), undefined);
  assert.equal(selectGrantedTargets(at("?container=nojson"), {}, TARGETS), undefined);
});

test("a session ticket redeems until it is revoked, which ends its captures with 1008", async (t) => {
  const packetflix = server();
  t.after(() => packetflix.close());
  const opened: { targets?: CaptureNodeTarget[]; aborted?: boolean } = {};
  const { ticket, packetflixUri } = await packetflix.mint({
    labName: "demo",
    targets: TARGETS,
    open: endlessCapture(["SHB", "IDB"], opened)
  });
  assert.match(packetflixUri, /^packetflix:ws:\/\/127\.0\.0\.1:\d+\/packetflix\/[\w-]+\?container=/);
  const container = JSON.parse(new URL(packetflixUri.replace(/^packetflix:/, "")).searchParams.get("container") ?? "");
  assert.deepEqual(container, { name: "demo", type: "c9s-lab", "network-interfaces": ["sros:1/1/3", "sros:1/1/4"] });

  // cshargextcap's discovery, then its capture at <path>/capture.
  const discovery = await fetch(linkUrl(packetflixUri, "/discover/mobyshark").replace(/^ws:/, "http:"));
  assert.deepEqual(await discovery.json(), { containers: [] });
  const first = await connect(linkUrl(packetflixUri, "/capture"));
  await until(() => first.messages.length === 2);
  assert.deepEqual(first.messages, ["SHB", "IDB"]);
  assert.deepEqual(opened.targets, TARGETS);

  // The client leaving stops its capture; the ticket still redeems.
  first.socket.close();
  await until(() => opened.aborted === true);
  opened.aborted = false;
  const second = await connect(linkUrl(packetflixUri));
  await until(() => second.messages.length === 2);

  packetflix.revoke(ticket);
  assert.deepEqual(await second.closed, { code: 1008, reason: "capture ticket revoked" });
  assert.equal(opened.aborted, true);
});

test("unknown tickets and ungranted interfaces are refused before the upgrade", async (t) => {
  const packetflix = server();
  t.after(() => packetflix.close());
  const { ticket, packetflixUri } = await packetflix.mint({
    labName: "demo",
    targets: TARGETS,
    open: endlessCapture([], {})
  });
  const url = linkUrl(packetflixUri);
  await assert.rejects(connect(url.replace(ticket, "nope")), /HTTP 404/);
  await assert.rejects(connect(`${url.split("?")[0]}?nif=other:eth1`), /HTTP 403/);
  // Keep the server up with a second ticket, then revoke the first.
  await packetflix.mint({ labName: "demo", targets: TARGETS, open: endlessCapture([], {}) });
  packetflix.revoke(ticket);
  await assert.rejects(connect(url), /HTTP 404/);
});

test("a capture that ends closes normally, one that fails with 1011", async (t) => {
  const packetflix = server();
  t.after(() => packetflix.close());
  const ended = await packetflix.mint({
    labName: "demo",
    targets: TARGETS,
    open: () =>
      Promise.resolve(
        (async function* () {
          yield new TextEncoder().encode("SHB");
        })()
      )
  });
  const normal = await connect(linkUrl(ended.packetflixUri));
  assert.deepEqual(await normal.closed, { code: 1000, reason: "capture ended" });
  assert.deepEqual(normal.messages, ["SHB"]);

  const failing = await packetflix.mint({
    labName: "demo",
    targets: TARGETS,
    open: () => Promise.reject(new Error("containerlab capture failed (exit 1): lab not found"))
  });
  const failed = await connect(linkUrl(failing.packetflixUri));
  assert.deepEqual(await failed.closed, { code: 1011, reason: "containerlab capture failed (exit 1): lab not found" });
});
