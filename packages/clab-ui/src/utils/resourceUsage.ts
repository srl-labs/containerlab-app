/** Formatting and load levels for the CPU and memory usage hosts stream. */

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "–";
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} %`;
}

export type CpuLoadLevel = "low" | "medium" | "high";

/** How busy a node is, where 100 % is one busy CPU. */
export function cpuLoadLevel(cpuPercent: number): CpuLoadLevel {
  if (cpuPercent >= 85) return "high";
  if (cpuPercent >= 50) return "medium";
  return "low";
}

/** Fill colors of the load levels; saturated enough for both themes. */
export const CPU_LOAD_COLORS: Readonly<Record<CpuLoadLevel, string>> = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#ef4444"
};
