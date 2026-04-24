export interface EndpointHealthMetrics {
  serverInfo: {
    version: string;
    uptime: string;
    startTime: string;
  };
  metrics: {
    cpu?: {
      usagePercent: number;
      numCPU: number;
      loadAvg1?: number;
      loadAvg5?: number;
      loadAvg15?: number;
      processPercent?: number;
    };
    mem?: {
      totalMem: number;
      usedMem: number;
      availableMem: number;
      usagePercent: number;
      processMemMB?: number;
      processMemPct?: number;
    };
    disk?: {
      path: string;
      totalDisk: number;
      usedDisk: number;
      freeDisk: number;
      usagePercent: number;
    };
  };
}

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

