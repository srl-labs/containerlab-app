import assert from "node:assert/strict";
import test from "node:test";

import { createEventStreamManager, reconnectDelay, type EventSourceLike } from "./eventStreamManager";
import type { EndpointStatus } from "./stores/endpointStore";
import type { EventStreamState } from "./stores/eventStreamStore";

class FakeSource implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly endpointId: string) {}

  open(): void {
    this.onopen?.(new Event("open"));
  }

  fail(data?: string): void {
    this.onerror?.(Object.assign(new Event("error"), data === undefined ? {} : { data }));
  }

  close(): void {
    this.closed = true;
  }
}

function harness(probeResults: EndpointStatus[] = []) {
  let now = 0;
  const pending = new Map<number, { at: number; callback: () => void }>();
  let nextTimer = 1;
  const sources: FakeSource[] = [];
  const states = new Map<string, EventStreamState | undefined>();
  const applied: Array<[string, EndpointStatus]> = [];
  const messages: Array<[string, string]> = [];
  const connected = new Map<string, boolean>();
  const probes: string[] = [];
  const manager = createEventStreamManager({
    open: (endpointId) => {
      const source = new FakeSource(endpointId);
      sources.push(source);
      return source;
    },
    onMessage: (endpointId, data) => messages.push([endpointId, data]),
    onConnectedChange: (endpointId, value) => connected.set(endpointId, value),
    probe: (endpointId) => {
      probes.push(endpointId);
      return Promise.resolve(probeResults.shift() ?? "connected");
    },
    applyEndpointStatus: (endpointId, status) => applied.push([endpointId, status]),
    publish: (endpointId, state) => states.set(endpointId, state),
    timers: {
      now: () => now,
      setTimeout: (callback, ms) => {
        const id = nextTimer++;
        pending.set(id, { at: now + ms, callback });
        return id;
      },
      clearTimeout: (handle) => {
        pending.delete(handle as number);
      }
    }
  });
  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].callback();
      // Let probe promises settle before the next timer.
      await new Promise((resolve) => setImmediate(resolve));
    }
    now = target;
  };
  const latest = (endpointId: string) => sources.filter((source) => source.endpointId === endpointId).at(-1)!;
  return { manager, sources, states, applied, messages, connected, probes, advance, latest };
}

test("backoff doubles from one second up to the cap", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 12].map((failures) => reconnectDelay(failures)), [
    1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000
  ]);
});

test("a failed stream is recreated with backoff after the API answers again", async () => {
  const run = harness(["offline", "connected"]);
  run.manager.sync([{ id: "a", status: "connected" }]);
  const first = run.latest("a");
  first.open();
  assert.equal(run.states.get("a")?.state, "connected");
  assert.equal(run.connected.get("a"), true);

  first.fail(JSON.stringify({ error: "lab host stream ended" }));
  assert.equal(first.closed, true);
  assert.equal(run.connected.get("a"), false);
  assert.deepEqual(run.states.get("a"), { state: "reconnecting", failures: 1, retryAt: 1000, error: "lab host stream ended" });

  await run.advance(1000);
  assert.deepEqual(run.probes, ["a"]);
  assert.deepEqual(run.applied, [["a", "offline"]]);
  assert.equal(run.sources.length, 1, "no stream while the API does not answer");
  assert.deepEqual(run.states.get("a"), { state: "reconnecting", failures: 2, retryAt: 3000, error: "lab host stream ended" });

  await run.advance(2000);
  assert.deepEqual(run.applied, [["a", "offline"], ["a", "connected"]]);
  assert.equal(run.sources.length, 2, "a closed stream is opened again");
  run.latest("a").open();
  assert.equal(run.states.get("a")?.state, "connected");
  await run.advance(10_000);
  assert.deepEqual(run.states.get("a"), { state: "connected", failures: 0 });
});

test("events reach the handler only from the current stream", () => {
  const run = harness();
  run.manager.sync([{ id: "a", status: "connected" }]);
  const source = run.latest("a");
  source.open();
  source.onmessage?.(new MessageEvent("message", { data: "{\"type\":\"container\"}" }));
  assert.deepEqual(run.messages, [["a", "{\"type\":\"container\"}"]]);
  source.fail();
  source.onmessage?.(new MessageEvent("message", { data: "late" }));
  assert.equal(run.messages.length, 1);
});

test("one lab host fails while the others keep their streams", async () => {
  const run = harness(["offline"]);
  run.manager.sync([{ id: "a", status: "connected" }, { id: "b", status: "connected" }]);
  run.latest("a").open();
  run.latest("b").open();
  run.latest("a").fail();
  await run.advance(1000);
  assert.equal(run.states.get("a")?.state, "reconnecting");
  assert.equal(run.states.get("b")?.state, "connected");
  assert.equal(run.latest("b").closed, false);
  assert.deepEqual(run.probes, ["a"]);
});

test("retry now skips the remaining backoff", async () => {
  const run = harness(["offline", "offline", "connected"]);
  run.manager.sync([{ id: "a", status: "connected" }]);
  run.latest("a").fail();
  await run.advance(1000);
  assert.equal(run.states.get("a")?.retryAt, 3000);
  run.manager.retryNow("a");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.probes.length, 2);
  assert.equal(run.states.get("a")?.retryAt, 1000 + 4000);
  run.manager.retryNow("a");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.sources.length, 2);
  assert.equal(run.states.get("a")?.state, "connecting");
});

test("an expired sign-in pauses the stream until the endpoint is connected again", async () => {
  const run = harness(["session_expired"]);
  run.manager.sync([{ id: "a", status: "connected" }]);
  run.latest("a").fail();
  await run.advance(1000);
  assert.equal(run.states.get("a")?.state, "paused");
  await run.advance(60_000);
  assert.equal(run.sources.length, 1, "no retries while waiting for a sign-in");

  run.manager.sync([{ id: "a", status: "session_expired" }]);
  run.manager.sync([{ id: "a", status: "connected" }]);
  assert.equal(run.sources.length, 2);
  assert.equal(run.states.get("a")?.state, "connecting");
});

test("hosts that start offline are retried, and removed hosts stop", async () => {
  const run = harness(["connected"]);
  run.manager.sync([{ id: "a", status: "offline" }, { id: "b", status: "saved" }]);
  assert.equal(run.sources.length, 0);
  assert.equal(run.states.get("a")?.state, "reconnecting");
  assert.equal(run.states.has("b"), false, "signed-out hosts have no stream");
  await run.advance(1000);
  assert.equal(run.sources.length, 1);

  run.manager.sync([]);
  assert.equal(run.latest("a").closed, true);
  assert.equal(run.states.get("a"), undefined);
});

test("a host another request found unreachable is checked again instead of staying offline", async () => {
  const run = harness(["connected"]);
  run.manager.sync([{ id: "a", status: "connected" }]);
  run.latest("a").open();
  run.manager.sync([{ id: "a", status: "offline" }]);
  assert.equal(run.latest("a").closed, true);
  assert.equal(run.states.get("a")?.state, "reconnecting");
  await run.advance(1000);
  assert.deepEqual(run.applied, [["a", "connected"]]);
  assert.equal(run.sources.length, 2);
});

test("a host that comes back while waiting reconnects without waiting out the backoff", async () => {
  const run = harness(["offline"]);
  run.manager.sync([{ id: "a", status: "connected" }]);
  run.latest("a").fail();
  await run.advance(1000);
  assert.equal(run.states.get("a")?.state, "reconnecting");
  run.manager.sync([{ id: "a", status: "offline" }]);
  run.manager.sync([{ id: "a", status: "connected" }]);
  assert.equal(run.sources.length, 2);
  run.manager.dispose();
  assert.equal(run.latest("a").closed, true);
});
