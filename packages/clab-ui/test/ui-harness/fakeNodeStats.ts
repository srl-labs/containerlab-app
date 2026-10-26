/**
 * Fake CPU and memory usage for the running nodes of a fake lab, posted like
 * a host's `node-stats-update` messages.
 */
import { MSG_NODE_STATS_UPDATE } from "../../src/core/messages/webview";
import type { HostNodeStats, HostRuntimeContainer } from "../../src/host";

const INTERVAL_SECONDS = 2;
const MEMORY_LIMIT_BYTES = 8 * 1024 ** 3;

/** A stable number from a name, so each node gets its own usage curve. */
function seed(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

export function fakeNodeStats(containers: HostRuntimeContainer[], tick: number): HostNodeStats[] {
  return containers
    .filter((container) => container.state === "running")
    .map((container) => {
      const base = seed(container.name);
      const wave = Math.sin((tick + (base % 17)) / 3);
      return {
        name: container.name,
        nodeName: container.nodeName,
        cpuPercent: Math.round((8 + (base % 30) + wave * 6) * 10) / 10,
        cpuCount: 8,
        memoryBytes: (256 + (base % 768) + Math.round(wave * 16)) * 1024 ** 2,
        memoryLimitBytes: MEMORY_LIMIT_BYTES,
        pids: 10 + (base % 40)
      };
    });
}

/** Posts samples for the given containers until they change or `follow(undefined)`. */
export function createFakeNodeStats(emit: (message: unknown) => void): {
  follow: (containers: HostRuntimeContainer[] | undefined) => void;
} {
  let timer: ReturnType<typeof setInterval> | undefined;
  let tick = 0;
  return {
    follow(containers) {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      emit({ type: MSG_NODE_STATS_UPDATE, data: { clear: true } });
      if (!containers) return;
      const post = () => {
        tick += 1;
        emit({
          type: MSG_NODE_STATS_UPDATE,
          data: {
            sample: {
              time: new Date().toISOString(),
              intervalSeconds: INTERVAL_SECONDS,
              nodes: fakeNodeStats(containers, tick)
            }
          }
        });
      };
      post();
      timer = setInterval(post, INTERVAL_SECONDS * 1000);
    }
  };
}
