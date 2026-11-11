import assert from "node:assert/strict";
import test from "node:test";

import { createImagesJobsWatcher } from "./jobsWatcher";
import type { ImagesJob, ImagesJobState } from "./types";

const job = (id: string, state: ImagesJobState, startedAt: string): ImagesJob => ({
  id,
  op: "pull",
  state,
  phase: "download",
  pct: null,
  message: "",
  log: [],
  startedAt,
  updatedAt: startedAt
});

function setup(initial: ImagesJob[], options: { onJobEnded?: (job: ImagesJob) => void } = {}) {
  const state = { jobs: initial, fail: false, cancelled: undefined as ImagesJob | undefined, started: undefined as ImagesJob | undefined, cancelError: undefined as Error | undefined };
  const timers: Array<{ run: () => void; ms: number; cleared: boolean }> = [];
  const client = {
    jobs: async () => {
      if (state.fail) throw new Error("network down");
      return { jobs: state.jobs, active: 0 };
    },
    startJob: async () => state.started as ImagesJob,
    cancelJob: async () => {
      if (state.cancelError) throw state.cancelError;
      return state.cancelled as ImagesJob;
    }
  };
  const watcher = createImagesJobsWatcher(client, {
    ...options,
    intervalMs: 123,
    setTimer: (run, ms) => {
      const timer = {
        run: () => {
          timer.cleared = true; // a fired timer is no longer pending
          run();
        },
        ms,
        cleared: false
      };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { cleared: boolean }).cleared = true;
    }
  });
  const pending = () => timers.filter((timer) => !timer.cleared);
  return { state, timers, pending, watcher };
}

test("refresh lists jobs newest first", async () => {
  const { watcher } = setup([job("a", "succeeded", "2024-01-01T00:00:00Z"), job("b", "failed", "2024-01-03T00:00:00Z"), job("c", "cancelled", "2024-01-02T00:00:00Z")]);
  await watcher.refresh();
  const snapshot = watcher.getSnapshot();
  assert.deepEqual(snapshot.jobs.map((entry) => entry.id), ["b", "c", "a"]);
  assert.equal(snapshot.loaded, true);
});

test("polling is scheduled only while a job is queued or running, and stops when all ended", async () => {
  const { state, timers, pending, watcher } = setup([job("a", "queued", "2024-01-01T00:00:00Z")]);
  await watcher.refresh();
  assert.equal(pending().length, 1);
  assert.equal(timers[0]?.ms, 123);

  state.jobs = [job("a", "running", "2024-01-01T00:00:00Z")];
  timers[0]?.run();
  await watcher.refresh();
  assert.equal(pending().length, 1, "still polling while running");

  state.jobs = [job("a", "succeeded", "2024-01-01T00:00:00Z")];
  pending()[0]?.run();
  await watcher.refresh();
  assert.equal(pending().length, 0, "no timer once all jobs ended");
});

test("start adds the job at once and schedules polling", async () => {
  const { state, pending, watcher } = setup([]);
  state.started = job("n", "queued", "2024-02-01T00:00:00Z");
  const result = await watcher.start({ op: "pull", ref: "labhub:x" });
  assert.equal(result.id, "n");
  assert.deepEqual(watcher.getSnapshot().jobs.map((entry) => entry.id), ["n"]);
  assert.equal(pending().length, 1);
});

test("cancel replaces the job with the cancelled one", async () => {
  const { state, pending, watcher } = setup([job("a", "running", "2024-01-01T00:00:00Z")]);
  await watcher.refresh();
  state.cancelled = job("a", "cancelled", "2024-01-01T00:00:00Z");
  await watcher.cancel("a");
  assert.equal(watcher.getSnapshot().jobs.length, 1);
  assert.equal(watcher.getSnapshot().jobs[0]?.state, "cancelled");
  assert.equal(pending().length, 0);
});

test("onJobEnded fires exactly once when a running job succeeds", async () => {
  const ended: ImagesJob[] = [];
  const { state, watcher } = setup([job("a", "running", "2024-01-01T00:00:00Z")], { onJobEnded: (entry) => ended.push(entry) });
  await watcher.refresh();
  assert.equal(ended.length, 0);
  state.jobs = [job("a", "succeeded", "2024-01-01T00:00:00Z")];
  await watcher.refresh();
  await watcher.refresh();
  assert.equal(ended.length, 1);
  assert.equal(ended[0]?.id, "a");
  assert.equal(ended[0]?.state, "succeeded");
});

test("a failing jobs() keeps the last jobs and sets error", async () => {
  const { state, watcher } = setup([job("a", "succeeded", "2024-01-01T00:00:00Z")]);
  await watcher.refresh();
  state.fail = true;
  await watcher.refresh();
  const snapshot = watcher.getSnapshot();
  assert.equal(snapshot.error, "network down");
  assert.deepEqual(snapshot.jobs.map((entry) => entry.id), ["a"]);
});

test("dispose stops scheduling", async () => {
  const { timers, pending, watcher } = setup([job("a", "running", "2024-01-01T00:00:00Z")]);
  await watcher.refresh();
  assert.equal(pending().length, 1);
  watcher.dispose();
  assert.equal(pending().length, 0, "pending timer cleared");
  const count = timers.length;
  await watcher.refresh();
  assert.equal(timers.length, count, "no new timer after dispose");
});

test("a 409 finishing cancel is not an error: the job is marked finishing until the poll shows its end", async () => {
  const { state, pending, watcher } = setup([job("a", "running", "2024-01-01T00:00:00Z")]);
  await watcher.refresh();
  state.cancelError = Object.assign(new Error("finishing up"), { code: "finishing" });
  await watcher.cancel("a");
  assert.deepEqual(watcher.getSnapshot().finishing, ["a"]);
  assert.equal(pending().length, 1);
  state.jobs = [job("a", "succeeded", "2024-01-01T00:00:00Z")];
  await watcher.refresh();
  assert.deepEqual(watcher.getSnapshot().finishing, []);
});

test("a 409 starting cancel keeps Cancel available: the job is not marked finishing", async () => {
  const { state, watcher } = setup([job("a", "running", "2024-01-01T00:00:00Z")]);
  await watcher.refresh();
  state.cancelError = Object.assign(new Error("starting"), { code: "starting" });
  await watcher.cancel("a");
  assert.deepEqual(watcher.getSnapshot().finishing, []);
});

test("other cancel failures still reject", async () => {
  const { state, watcher } = setup([job("a", "running", "2024-01-01T00:00:00Z")]);
  await watcher.refresh();
  state.cancelError = Object.assign(new Error("not ours"), { code: "not_ours" });
  await assert.rejects(watcher.cancel("a"), /not ours/);
  assert.deepEqual(watcher.getSnapshot().finishing, []);
});
