import assert from "node:assert/strict";
import test from "node:test";

import type { HostNodeStatsSample } from "../../host/contracts";

import type { LabOverviewCard } from "./labsOverview";
import type { LabUsageUpdate } from "./labUsage";
import { createLabUsageFeed, MAX_LAB_USAGE_STREAMS, type LabUsageFeedDeps } from "./labUsageFeed";

function card(labName: string, endpointId = "ep1"): LabOverviewCard {
  return {
    id: `${endpointId}::${labName}`, endpointId, endpointLabel: endpointId, name: labName, labName,
    shared: false, state: "running", nodeCount: 1, readyCount: 1, nodes: {}, canDeploy: false, canDestroy: true
  };
}

function sample(cpuPercent: number): HostNodeStatsSample {
  return {
    time: new Date().toISOString(),
    intervalSeconds: 3,
    nodes: [{ name: "clab-x-a", nodeName: "a", cpuPercent, memoryBytes: 1024 }]
  };
}

/** A stats stream the test feeds by hand, ending when its signal aborts. */
class FakeStream {
  readonly queue: HostNodeStatsSample[] = [];
  error: unknown;
  private wake?: () => void;

  constructor(readonly labName: string, readonly signal: AbortSignal) {
    signal.addEventListener("abort", () => this.wake?.());
  }

  push(value: HostNodeStatsSample): void {
    this.queue.push(value);
    this.wake?.();
  }

  fail(error: unknown): void {
    this.error = error;
    this.wake?.();
  }

  async *values(): AsyncGenerator<HostNodeStatsSample> {
    while (!this.signal.aborted) {
      const next = this.queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.error) throw this.error;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

function harness(options: { supported?: boolean } = {}) {
  const streams: FakeStream[] = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  let hidden = false;
  let visibilityListener: (() => void) | undefined;
  const deps: LabUsageFeedDeps = {
    streamLabStats: ({ labName, signal }) => {
      const stream = new FakeStream(labName, signal);
      streams.push(stream);
      return stream.values();
    },
    supportsNodeStats: () => Promise.resolve(options.supported ?? true),
    isHidden: () => hidden,
    onVisibilityChange: (listener) => {
      visibilityListener = listener;
      return () => {
        visibilityListener = undefined;
      };
    },
    setTimer: (callback) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    }
  };
  const feed = createLabUsageFeed(deps);
  return {
    feed,
    streams,
    open: () => streams.filter((stream) => !stream.signal.aborted),
    runTimers: () => {
      const pending = [...timers.entries()];
      timers.clear();
      for (const [, callback] of pending) callback();
    },
    setHidden: (value: boolean) => {
      hidden = value;
      visibilityListener?.();
    }
  };
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test("a visible card streams its lab and gets live usage", async () => {
  const { feed, open } = harness();
  const updates: LabUsageUpdate[] = [];
  const stop = feed.watch(card("demo"), (update) => updates.push(update));
  assert.deepEqual(updates, [{ status: "pending" }]);
  await settle();
  assert.deepEqual(open().map((stream) => stream.labName), ["demo"]);
  open()[0].push(sample(12));
  await settle();
  const last = updates.at(-1);
  assert.equal(last?.status, "live");
  assert.equal(last?.status === "live" ? last.usage.cpuPercent : undefined, 12);
  stop();
  feed.dispose();
});

test("two cards of one lab share a stream, which stops a moment after the last one leaves", async () => {
  const { feed, open, runTimers } = harness();
  const stopFirst = feed.watch(card("demo"), () => {});
  const stopSecond = feed.watch(card("demo"), () => {});
  await settle();
  assert.equal(open().length, 1);
  stopFirst();
  stopSecond();
  assert.equal(open().length, 1, "lingers while the card may scroll back");
  runTimers();
  await settle();
  assert.equal(open().length, 0);
  feed.dispose();
});

test("a card that comes back sees the last usage at once", async () => {
  const { feed, open, runTimers } = harness();
  const stop = feed.watch(card("demo"), () => {});
  await settle();
  open()[0].push(sample(30));
  await settle();
  stop();
  runTimers();
  await settle();
  const updates: LabUsageUpdate[] = [];
  feed.watch(card("demo"), (update) => updates.push(update));
  assert.equal(updates[0]?.status, "live");
  feed.dispose();
});

test("no more than the stream limit run at once, and waiting cards start when one ends", async () => {
  const { feed, open, runTimers } = harness();
  const stops = Array.from({ length: MAX_LAB_USAGE_STREAMS + 2 }, (_, index) => feed.watch(card(`lab${index}`), () => {}));
  await settle();
  assert.equal(open().length, MAX_LAB_USAGE_STREAMS);
  stops[0]();
  runTimers();
  await settle();
  assert.equal(open().length, MAX_LAB_USAGE_STREAMS);
  assert.ok(open().some((stream) => stream.labName === `lab${MAX_LAB_USAGE_STREAMS}`));
  feed.dispose();
  await settle();
  assert.equal(open().length, 0);
});

test("a lab host without node stats shows no usage and opens no stream", async () => {
  const { feed, streams } = harness({ supported: false });
  const updates: LabUsageUpdate[] = [];
  feed.watch(card("demo"), (update) => updates.push(update));
  await settle();
  assert.equal(streams.length, 0);
  assert.deepEqual(updates.at(-1), { status: "unavailable" });
  feed.dispose();
});

test("a 501 from the stream marks the lab host as unable to report usage", async () => {
  const { feed, open, streams } = harness();
  const updates: LabUsageUpdate[] = [];
  feed.watch(card("demo"), (update) => updates.push(update));
  await settle();
  open()[0].fail(Object.assign(new Error("Update clab-api-server."), { status: 501 }));
  await settle();
  assert.deepEqual(updates.at(-1), { status: "unavailable", reason: "Update clab-api-server." });
  const later: LabUsageUpdate[] = [];
  feed.watch(card("other"), (update) => later.push(update));
  await settle();
  assert.deepEqual(later, [{ status: "unavailable" }]);
  assert.equal(streams.length, 1);
  feed.dispose();
});

test("streams pause while the page is hidden", async () => {
  const { feed, open, setHidden } = harness();
  feed.watch(card("demo"), () => {});
  await settle();
  assert.equal(open().length, 1);
  setHidden(true);
  await settle();
  assert.equal(open().length, 0);
  setHidden(false);
  await settle();
  assert.equal(open().length, 1);
  feed.dispose();
});
