/** What the engine is doing on each node: its gNMI stream, and what is wrong there. */
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import React, { useMemo } from "react";

import { useFabric } from "./fabricContext";
import { ago, natural, plural } from "./fabricFormat";
import { nodeRoute } from "./fabricRoute";
import type { FabricFindingCounts } from "./fabricTypes";
import { EmptyState, FindingBadges, LoadingNote, MONO_SX, Pill, TABLE_SX, TextLink, ViewHeader, type FabricTone } from "./fabricUi";

const STATUS_ORDER: Readonly<Record<string, number>> = { down: 0, connecting: 1, syncing: 2, live: 3 };

const STATUS_TONES: Readonly<Record<string, FabricTone>> = {
  live: "good",
  syncing: "info",
  connecting: "warn",
  down: "bad"
};

export function FabricNodesView(): React.JSX.Element {
  const { status, topology, go } = useFabric();
  const findings = useMemo(
    () => new Map<string, FabricFindingCounts | undefined>((topology?.nodes ?? []).map((node) => [node.name, node.findings])),
    [topology]
  );
  const nodes = useMemo(
    () => [...(status?.nodes ?? [])].sort(
      (a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || natural(a.name, b.name)
    ),
    [status]
  );
  const live = nodes.filter((node) => node.status === "live").length;
  const streamed = status?.streamed ?? [];
  return (
    <Box data-testid="fabric-nodes" sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ViewHeader
        title="Nodes"
        detail={status ? [
          `${live} of ${plural(nodes.length, "node")} live`,
          status.started ? `engine up since ${ago(status.started)}` : "",
          streamed.length > 0 ? `streaming ${plural(streamed.length, "report")}` : ""
        ].filter(Boolean).join(" · ") : undefined}
      />
      {!status ? <LoadingNote label="Reading the nodes…" sx={{ px: 2 }} /> : null}
      {status && nodes.length === 0 ? (
        <EmptyState icon={<DnsOutlinedIcon />} title="No SR Linux nodes" detail="fcling follows the SR Linux nodes of a lab, and this lab has none." />
      ) : null}
      {nodes.length > 0 ? (
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", borderTop: 1, borderColor: "divider" }}>
          <Box component="table" sx={TABLE_SX} data-testid="fabric-nodes-table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Status</th>
                <th>Findings</th>
                <th>Since</th>
                <th>Last heard</th>
                <th>Address</th>
                <th>Labels</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((node) => (
                <tr key={node.name} data-testid={`fabric-node-row-${node.name}`}>
                  <td><TextLink onClick={() => go(nodeRoute(node.name))}>{node.name}</TextLink></td>
                  <td>
                    <Pill dot tone={STATUS_TONES[node.status] ?? "neutral"}>{node.status}</Pill>
                    {node.error ? (
                      <Typography variant="caption" component="div" sx={{ color: "error.main", mt: 0.25 }}>{node.error}</Typography>
                    ) : null}
                  </td>
                  <td><FindingBadges findings={findings.get(node.name)} /></td>
                  <td>{ago(node.since)}</td>
                  <td>{ago(node.heard)}</td>
                  <td><Box component="span" sx={MONO_SX}>{node.address}</Box></td>
                  <td>
                    <Box component="span" sx={{ color: "text.secondary" }}>
                      {Object.entries(node.labels ?? {}).map(([key, value]) => `${key}=${value}`).join(" ")}
                    </Box>
                  </td>
                </tr>
              ))}
            </tbody>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
