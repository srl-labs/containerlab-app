/** The kept changes over the window, as bars by kind. A click narrows the list to one bar. */
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import React, { useMemo } from "react";

import { clock, plural } from "./fabricFormat";
import {
  barShare,
  CHANGE_KIND_LABELS,
  CHANGE_KINDS,
  timelineBuckets,
  type FabricChangeKind
} from "./fabricHistory";
import type { FabricChange } from "./fabricTypes";
import { toneColor } from "./fabricUi";

const BUCKETS = 60;
const HEIGHT = 72;

/** Findings wear the status colours; a commit and what it caused share a hue; the rest is neutral. */
const KIND_COLORS: Readonly<Record<FabricChangeKind, string>> = {
  raised: toneColor("bad"),
  cleared: toneColor("good"),
  commit: "var(--vscode-charts-purple, #a371f7)",
  config: "color-mix(in srgb, var(--vscode-charts-purple, #a371f7) 50%, transparent)",
  change: "color-mix(in srgb, var(--vscode-descriptionForeground) 55%, transparent)"
};

export function FabricTimeline({ changes, from, to, range, onRange }: {
  changes: readonly FabricChange[];
  from: number;
  to: number;
  range: readonly [number, number] | undefined;
  onRange: (range: readonly [number, number] | undefined) => void;
}): React.JSX.Element {
  const buckets = useMemo(() => timelineBuckets(changes, from, to, BUCKETS), [changes, from, to]);
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.total));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => from + share * (to - from));
  return (
    <Box sx={{ flexShrink: 0, px: 2, pb: 1 }} data-testid="fabric-timeline">
      <Box sx={{ display: "flex", alignItems: "flex-end", gap: "2px", height: HEIGHT, borderBottom: 1, borderColor: "divider" }}>
        {buckets.map((bucket, index) => {
          const picked = range !== undefined && range[0] <= bucket.start && bucket.start < range[1];
          const barHeight = barShare(bucket.total, peak) * (HEIGHT - 4);
          const kinds = CHANGE_KINDS.filter((kind) => bucket.counts[kind] > 0);
          return (
            <Tooltip
              key={index}
              disableInteractive
              title={(
                <Box sx={{ fontSize: 12 }}>
                  <div>{clock(bucket.start)}</div>
                  {kinds.length === 0 ? <div>Nothing changed</div> : kinds.map((kind) => (
                    <Box key={kind} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: "2px", bgcolor: KIND_COLORS[kind] }} />
                      {bucket.counts[kind]} {CHANGE_KIND_LABELS[kind].toLowerCase()}
                    </Box>
                  ))}
                </Box>
              )}
            >
              <Box
                component="button"
                type="button"
                aria-label={`${clock(bucket.start)}: ${plural(bucket.total, "change")}`}
                aria-pressed={picked}
                onClick={() => onRange(picked ? undefined : [bucket.start, bucket.end])}
                sx={{
                  all: "unset", flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", cursor: "pointer",
                  bgcolor: picked ? "action.selected" : "transparent", borderRadius: "2px 2px 0 0",
                  "&:hover": { bgcolor: "action.hover" },
                  "&:focus-visible": { outline: "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))" }
                }}
              >
                {barHeight > 0 ? (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: "1px", height: Math.max(3, barHeight), borderRadius: "3px 3px 0 0", overflow: "hidden" }}>
                    {kinds.map((kind) => (
                      <Box key={kind} sx={{ flex: bucket.counts[kind], minHeight: 2, bgcolor: KIND_COLORS[kind] }} />
                    ))}
                  </Box>
                ) : null}
              </Box>
            </Tooltip>
          );
        })}
      </Box>
      <Box sx={{ display: "flex", justifyContent: "space-between", mt: 0.25 }}>
        {ticks.map((tick, index) => (
          <Typography key={index} variant="caption" sx={{ color: "text.secondary", fontSize: 11 }}>{clock(tick)}</Typography>
        ))}
      </Box>
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mt: 0.5 }}>
        {CHANGE_KINDS.map((kind) => (
          <Box key={kind} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: "2px", bgcolor: KIND_COLORS[kind] }} />
            <Typography variant="caption" sx={{ color: "text.secondary", fontSize: 11 }}>{CHANGE_KIND_LABELS[kind]}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
