// The traffic chart's series, kept apart so a legend needn't load the chart library.

export const TRAFFIC_SERIES_COLORS = {
  rxBps: "#4ec9b0",
  txBps: "#569cd6",
  rxPps: "#b5cea8",
  txPps: "#9cdcfe"
} as const;

/** What a legend beside the chart shows, in the chart's order. */
export const TRAFFIC_LEGEND: ReadonlyArray<{ label: string; color: string }> = [
  { label: "RX", color: TRAFFIC_SERIES_COLORS.rxBps },
  { label: "TX", color: TRAFFIC_SERIES_COLORS.txBps },
  { label: "RX PPS", color: TRAFFIC_SERIES_COLORS.rxPps },
  { label: "TX PPS", color: TRAFFIC_SERIES_COLORS.txPps }
];
