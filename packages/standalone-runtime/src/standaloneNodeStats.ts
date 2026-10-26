/**
 * Streams the CPU and memory usage of the open, deployed lab and hands each
 * sample to the topology view as a `node-stats-update` message.
 */
import { MSG_NODE_STATS_UPDATE, type TopologyRef } from "@containerlab/clab-ui/session";

import { RuntimeStreamError, streamLabStats } from "./runtimeApi";

const STATS_INTERVAL_SECONDS = 2;
const RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];

interface NodeStatsTarget {
  topologyRef: TopologyRef;
  sessionId?: string;
  endpointId?: string;
}

function postStatsMessage(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { data: { type: MSG_NODE_STATS_UPDATE, data } }));
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, ms);
    function done() {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function targetKey(target: NodeStatsTarget | null): string {
  return target ? `${target.endpointId ?? ""}|${target.topologyRef.topologyId}|${target.sessionId ?? ""}` : "";
}

export interface NodeStatsFeed {
  /** The deployed topology to stream, or null to stop. */
  setTarget(target: NodeStatsTarget | null): void;
}

export function createNodeStatsFeed(): NodeStatsFeed {
  let currentKey = "";
  let controller: AbortController | null = null;

  async function run(target: NodeStatsTarget, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; !signal.aborted; attempt += 1) {
      try {
        for await (const sample of streamLabStats({ ...target, intervalSeconds: STATS_INTERVAL_SECONDS, signal })) {
          attempt = 0;
          postStatsMessage({ sample });
        }
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof RuntimeStreamError && error.status === 501) {
          postStatsMessage({ unavailable: error.message });
          return;
        }
      }
      await wait(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)], signal);
    }
  }

  return {
    setTarget(target) {
      const key = targetKey(target);
      if (key === currentKey) return;
      currentKey = key;
      controller?.abort();
      controller = null;
      postStatsMessage({ clear: true });
      if (!target) return;
      controller = new AbortController();
      void run(target, controller.signal);
    }
  };
}
