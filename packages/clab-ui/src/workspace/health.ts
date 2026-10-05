import type { EndpointHealthMetrics } from "./types";
export type { EndpointHealthMetrics } from "./types";
export function formatEndpointHealthPercent(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "n/a";
  }
  const digits = Math.abs(value) >= 10 ? 0 : 1;
  return `${value.toFixed(digits)}%`;
}

export function formatEndpointHealthBytes(value: number | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "n/a";
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  const digits = unitIndex === 0 || amount >= 10 ? 0 : 1;
  return `${amount.toFixed(digits)} ${units[unitIndex]}`;
}

export function formatEndpointHealthUsedTotal(
  used: number | undefined,
  total: number | undefined
): string {
  return `${formatEndpointHealthBytes(used)} / ${formatEndpointHealthBytes(total)}`;
}

export function formatEndpointHealthTooltip(metrics: EndpointHealthMetrics): string {
  const { cpu, mem, disk } = metrics.metrics;
  const cpuDetail = cpu?.numCPU ? `${cpu.numCPU} cores` : "cores n/a";
  const memoryDetail = formatEndpointHealthUsedTotal(mem?.usedMem, mem?.totalMem);
  const diskDetail = `${formatEndpointHealthUsedTotal(disk?.usedDisk, disk?.totalDisk)}${
    disk?.path ? ` on ${disk.path}` : ""
  }`;

  return [
    `CPU: ${formatEndpointHealthPercent(cpu?.usagePercent)} (${cpuDetail})`,
    `Memory: ${formatEndpointHealthPercent(mem?.usagePercent)} (${memoryDetail})`,
    `Disk: ${formatEndpointHealthPercent(disk?.usagePercent)} (${diskDetail})`
  ].join("\n");
}
