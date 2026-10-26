// Sparkline of a node's CPU or memory usage.
import React from "react";
import { SparkLineChart } from "@mui/x-charts/SparkLineChart";

export interface NodeResourceSparklineProps {
  data: number[];
  color: string;
  /** The top of the scale. */
  max: number;
  valueFormatter: (value: number | null) => string;
}

export const NodeResourceSparkline: React.FC<NodeResourceSparklineProps> = ({
  data,
  color,
  max,
  valueFormatter
}) => (
  <SparkLineChart
    data={data}
    height={44}
    curve="linear"
    color={color}
    showHighlight
    showTooltip
    valueFormatter={valueFormatter}
    yAxis={{ min: 0, max }}
  />
);
