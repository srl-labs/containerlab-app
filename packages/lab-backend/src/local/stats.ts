import type Docker from "dockerode";

import type { LabStatsSample, NodeStats } from "../contract/dto.ts";

/** How often the stream looks for nodes that started or stopped. */
const CONTAINER_REFRESH_MS = 10_000;

/** Raw counters of one container; CPU usage is a percentage only between two samples. */
export interface StatsCounters {
  /** CPU time used, summed over all CPUs, in ns. */
  cpuNanos: number;
  /** Advances by one second per second of wall time, in ns. */
  clockNanos: number;
  cpuCount: number;
  memoryBytes: number;
  memoryLimitBytes: number;
  pids: number;
}

/**
 * The counters of a Docker Engine stats response, as `docker stats` reads them.
 * Undefined when the engine could not collect them: it then answers 200 with
 * only a `message`, e.g. for SR Linux, which renames the container's eth0.
 */
export function statsCounters(stats: Docker.ContainerStats): StatsCounters | undefined {
  const cpuStats = stats.cpu_stats as Docker.ContainerStats["cpu_stats"] | undefined;
  const memory = stats.memory_stats as Docker.ContainerStats["memory_stats"] | undefined;
  if (typeof cpuStats?.cpu_usage?.total_usage !== "number" || !memory) return undefined;
  const cpuCount = cpuStats.online_cpus || cpuStats.cpu_usage.percpu_usage?.length || 0;
  const memoryStats = (memory.stats ?? {}) as Partial<Record<string, number>>;
  // Page cache that can be reclaimed does not count: cgroup v2, then v1.
  const inactive = memoryStats.inactive_file ?? memoryStats.total_inactive_file ?? 0;
  const usage = memory.usage ?? 0;
  return {
    cpuNanos: cpuStats.cpu_usage.total_usage,
    clockNanos: cpuCount > 0 ? (cpuStats.system_cpu_usage ?? 0) / cpuCount : 0,
    cpuCount,
    memoryBytes: inactive < usage ? usage - inactive : usage,
    memoryLimitBytes: memory.limit ?? 0,
    pids: stats.pids_stats?.current ?? 0
  };
}

/** CPU usage between two samples, where 100 is one busy CPU; undefined after a restart. */
export function cpuPercent(previous: StatsCounters, current: StatsCounters): number | undefined {
  if (current.clockNanos <= previous.clockNanos || current.cpuNanos < previous.cpuNanos) {
    return undefined;
  }
  const percent = ((current.cpuNanos - previous.cpuNanos) / (current.clockNanos - previous.clockNanos)) * 100;
  return Math.round(percent * 10) / 10;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Samples the running nodes of a lab through the Docker Engine API, one
 * sample per interval, like clab-api-server's stats stream.
 */
export async function* labStats(
  docker: Docker,
  labName: string,
  intervalSeconds: number,
  signal: AbortSignal
): AsyncGenerator<LabStatsSample> {
  let containers: Docker.ContainerInfo[] = [];
  let listedAt = Number.NEGATIVE_INFINITY;
  let previous = new Map<string, StatsCounters>();
  while (!signal.aborted) {
    if (Date.now() - listedAt >= CONTAINER_REFRESH_MS) {
      const listed = await docker.listContainers({
        filters: { label: [`containerlab=${labName}`], status: ["running"] }
      });
      containers = listed.filter((container) => container.Labels["clab-internal-node"] !== "true");
      listedAt = Date.now();
    }
    const current = new Map<string, StatsCounters>();
    const nodes: NodeStats[] = [];
    const samples = await Promise.all(
      containers.map((container) =>
        docker
          .getContainer(container.Id)
          .stats({ stream: false, "one-shot": true })
          .then(statsCounters)
          .catch(() => undefined)
      )
    );
    containers.forEach((container, index) => {
      const counters = samples[index];
      if (!counters) return;
      current.set(container.Id, counters);
      const before = previous.get(container.Id);
      const percent = before ? cpuPercent(before, counters) : undefined;
      nodes.push({
        name: (container.Names[0] ?? container.Id).replace(/^\//, ""),
        nodeName: container.Labels["clab-node-name"] ?? "",
        ...(percent !== undefined ? { cpuPercent: percent } : {}),
        ...(counters.cpuCount > 0 ? { cpuCount: counters.cpuCount } : {}),
        memoryBytes: counters.memoryBytes,
        ...(counters.memoryLimitBytes > 0 ? { memoryLimitBytes: counters.memoryLimitBytes } : {}),
        ...(counters.pids > 0 ? { pids: counters.pids } : {})
      });
    });
    previous = current;
    if (signal.aborted) return;
    yield { type: "stats", time: new Date().toISOString(), intervalSeconds, nodes };
    await sleep(intervalSeconds * 1000, signal);
  }
}
