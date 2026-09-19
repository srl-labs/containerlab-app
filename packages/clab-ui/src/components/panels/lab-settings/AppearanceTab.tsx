/* eslint-disable import-x/max-dependencies */
import React, { useMemo, useState } from "react";
import type { Edge } from "@xyflow/react";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { SettingsField } from "../../../settings/SettingsField";
import { useEdges } from "../../../stores/graphStore";
import { useTopoViewerStore } from "../../../stores/topoViewerStore";
import {
  DEFAULT_TELEMETRY_INTERFACE_SIZE_PERCENT,
  DEFAULT_TELEMETRY_NODE_SIZE_PX,
  GLOBAL_INTERFACE_PART_INDEX_PREFIX,
  INTERFACE_SELECT_AUTO,
  INTERFACE_SELECT_FULL,
  INTERFACE_SELECT_TOKEN_PREFIX,
  clampTelemetryInterfaceSizePercent,
  clampTelemetryNodeSizePx,
  getInterfaceSelectionValue,
  parseBoundedNumber,
  resolveInterfaceOverrideValue,
  splitInterfaceParts
} from "../../../utils/telemetryInterfaceLabels";

interface EdgeInterfaceRow {
  edgeId: string;
  source: string;
  target: string;
  sourceEndpoint: string;
  targetEndpoint: string;
}

interface AppearanceTabProps {
  isReadOnly: boolean;
  showRateLabels: boolean;
  onShowRateLabelsChange: (enabled: boolean) => void;
}

type TelemetryStyleValue = "default" | "telemetry-style";

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractEdgeInterfaceRows(edges: Edge[]): EdgeInterfaceRow[] {
  const rows: EdgeInterfaceRow[] = [];
  for (const edge of edges) {
    const sourceEndpoint = asNonEmptyString(edge.data?.sourceEndpoint);
    const targetEndpoint = asNonEmptyString(edge.data?.targetEndpoint);
    if (sourceEndpoint === null || targetEndpoint === null) continue;

    rows.push({
      edgeId: edge.id,
      source: edge.source,
      target: edge.target,
      sourceEndpoint,
      targetEndpoint
    });
  }
  return rows;
}

export const AppearanceTab: React.FC<AppearanceTabProps> = ({
  isReadOnly,
  showRateLabels,
  onShowRateLabelsChange
}) => {
  const edges = useEdges();
  const [interfaceLinkFilter, setInterfaceLinkFilter] = useState("");

  const linkLabelMode = useTopoViewerStore((state) => state.linkLabelMode);
  const lastNonTelemetryLinkLabelMode = useTopoViewerStore(
    (state) => state.lastNonTelemetryLinkLabelMode
  );

  const telemetryNodeSizePx = useTopoViewerStore((state) => state.telemetryNodeSizePx);
  const telemetryInterfaceSizePercent = useTopoViewerStore(
    (state) => state.telemetryInterfaceSizePercent
  );
  const globalInterfaceOverrideSelection = useTopoViewerStore(
    (state) => state.telemetryGlobalInterfaceOverrideSelection
  );
  const interfaceLabelOverrides = useTopoViewerStore(
    (state) => state.telemetryInterfaceLabelOverrides
  );

  const setLinkLabelMode = useTopoViewerStore((state) => state.setLinkLabelMode);
  const setTelemetryNodeSizePx = useTopoViewerStore((state) => state.setTelemetryNodeSizePx);
  const setTelemetryInterfaceSizePercent = useTopoViewerStore(
    (state) => state.setTelemetryInterfaceSizePercent
  );
  const setTelemetryGlobalInterfaceOverrideSelection = useTopoViewerStore(
    (state) => state.setTelemetryGlobalInterfaceOverrideSelection
  );
  const setTelemetryInterfaceLabelOverride = useTopoViewerStore(
    (state) => state.setTelemetryInterfaceLabelOverride
  );

  const telemetryStyleValue: TelemetryStyleValue =
    linkLabelMode === "telemetry-style" ? "telemetry-style" : "default";
  const isTelemetryStyleEnabled = telemetryStyleValue === "telemetry-style";

  const interfaceRows = useMemo(() => extractEdgeInterfaceRows(edges), [edges]);

  const filteredInterfaceRows = useMemo(() => {
    const filterValue = interfaceLinkFilter.trim().toLowerCase();
    if (filterValue.length === 0) return interfaceRows;
    return interfaceRows.filter((row) =>
      [row.edgeId, row.source, row.target, row.sourceEndpoint, row.targetEndpoint]
        .join(" ")
        .toLowerCase()
        .includes(filterValue)
    );
  }, [interfaceRows, interfaceLinkFilter]);

  const interfaceEndpoints = useMemo(() => {
    const unique = new Set<string>();
    for (const row of interfaceRows) {
      unique.add(row.sourceEndpoint);
      unique.add(row.targetEndpoint);
    }
    return Array.from(unique.values());
  }, [interfaceRows]);

  const maxInterfacePartCount = useMemo(() => {
    let maxCount = 1;
    for (const endpoint of interfaceEndpoints) {
      maxCount = Math.max(maxCount, splitInterfaceParts(endpoint).length);
    }
    return maxCount;
  }, [interfaceEndpoints]);

  return (
    <>
      <SettingsField title="Style" description="Default link labels or telemetry-style appearance.">
        <TextField
          slotProps={{ select: { inputProps: { "aria-label": "Style" } } }}
          select
          size="small"
          value={telemetryStyleValue}
          disabled={isReadOnly}
          onChange={(e) => {
            if (isReadOnly) return;
            const value = e.target.value;
            const nextLinkLabelMode =
              value === "telemetry-style" ? "telemetry-style" : lastNonTelemetryLinkLabelMode;
            setLinkLabelMode(nextLinkLabelMode);
          }}
          data-testid="lab-settings-telemetry-style"
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="default">Default</MenuItem>
          <MenuItem value="telemetry-style">Telemetry Style</MenuItem>
        </TextField>
      </SettingsField>
      <SettingsField title="Node size" description="Telemetry node marker size in pixels.">
        <TextField
          id="telemetry-node-size"
          size="small"
          type="number"
          value={String(telemetryNodeSizePx)}
          disabled={isReadOnly}
          onChange={(e) => {
            if (isReadOnly) return;
            setTelemetryNodeSizePx(
              clampTelemetryNodeSizePx(
                parseBoundedNumber(e.target.value, 12, 240, DEFAULT_TELEMETRY_NODE_SIZE_PX)
              )
            );
          }}
          slotProps={{
            htmlInput: { "aria-label": "Node size", min: 12, max: 240, step: 1 },
            input: { endAdornment: <InputAdornment position="end">px</InputAdornment> }
          }}
          sx={{ width: 160 }}
        />
      </SettingsField>
      <SettingsField title="Interface size" description="Telemetry interface label size as a percent of node size.">
        <TextField
          id="telemetry-interface-size"
          size="small"
          type="number"
          value={String(telemetryInterfaceSizePercent)}
          disabled={isReadOnly}
          onChange={(e) => {
            if (isReadOnly) return;
            setTelemetryInterfaceSizePercent(
              clampTelemetryInterfaceSizePercent(
                parseBoundedNumber(e.target.value, 40, 400, DEFAULT_TELEMETRY_INTERFACE_SIZE_PERCENT)
              )
            );
          }}
          slotProps={{
            htmlInput: { "aria-label": "Interface size", min: 40, max: 400, step: 5 },
            input: { endAdornment: <InputAdornment position="end">%</InputAdornment> }
          }}
          sx={{ width: 160 }}
        />
      </SettingsField>
      <SettingsField title="Show rate labels" description="Show traffic rate labels on links.">
        <Switch
          size="small"
          checked={showRateLabels}
          disabled={isReadOnly}
          slotProps={{ input: { "aria-label": "Show rate labels" } }}
          onChange={(e) => {
            if (isReadOnly) return;
            onShowRateLabelsChange(e.target.checked);
          }}
        />
      </SettingsField>
      {isTelemetryStyleEnabled ? (
        <>
          <SettingsField
            title="Global override"
            description="Interface label format applied to every link."
          >
            <TextField
              slotProps={{ select: { inputProps: { "aria-label": "Global override" } } }}
              select
              size="small"
              value={globalInterfaceOverrideSelection}
              disabled={isReadOnly}
              onChange={(e) => {
                if (isReadOnly) return;
                setTelemetryGlobalInterfaceOverrideSelection(e.target.value);
              }}
              sx={{ minWidth: 180 }}
            >
              <MenuItem value={INTERFACE_SELECT_AUTO}>Auto</MenuItem>
              <MenuItem value={INTERFACE_SELECT_FULL}>Full interface name</MenuItem>
              {Array.from({ length: maxInterfacePartCount }, (_, index) => index + 1).map(
                (partIndex) => (
                  <MenuItem
                    key={`global-interface-part-${partIndex}`}
                    value={`${GLOBAL_INTERFACE_PART_INDEX_PREFIX}${partIndex}`}
                  >
                    Part {partIndex}
                  </MenuItem>
                )
              )}
            </TextField>
          </SettingsField>
          <SettingsField
            title="Filter links"
            description={`${filteredInterfaceRows.length} of ${interfaceRows.length} links shown.`}
          >
            <TextField
              slotProps={{ htmlInput: { "aria-label": "Filter links" } }}
              size="small"
              placeholder="Search node or interface name"
              value={interfaceLinkFilter}
              disabled={isReadOnly}
              onChange={(e) => setInterfaceLinkFilter(e.target.value)}
              sx={{ minWidth: 220 }}
            />
          </SettingsField>
          <SettingsField
            title="Interface labels"
            description="Override the label format per link endpoint."
            wide
          >
            <Box
              sx={{
                maxHeight: 360,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 1
              }}
            >
              {filteredInterfaceRows.length === 0 ? (
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  No links match the current filter.
                </Typography>
              ) : (
                filteredInterfaceRows.map((row) => {
                  const sourceParts = splitInterfaceParts(row.sourceEndpoint);
                  const targetParts = splitInterfaceParts(row.targetEndpoint);
                  return (
                    <Box key={row.edgeId} sx={{ display: "grid", rowGap: 1 }}>
                      <Typography variant="caption" sx={{ color: "text.secondary" }}>
                        {row.source} {"<->"} {row.target}
                      </Typography>
                      <Box
                        sx={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 1
                        }}
                      >
                        <TextField
                          select
                          size="small"
                          label={row.sourceEndpoint}
                          value={getInterfaceSelectionValue(
                            row.sourceEndpoint,
                            interfaceLabelOverrides
                          )}
                          disabled={isReadOnly}
                          onChange={(e) => {
                            if (isReadOnly) return;
                            setTelemetryInterfaceLabelOverride(
                              row.sourceEndpoint,
                              resolveInterfaceOverrideValue(row.sourceEndpoint, e.target.value)
                            );
                          }}
                        >
                          <MenuItem value={INTERFACE_SELECT_AUTO}>Auto (use global)</MenuItem>
                          <MenuItem value={INTERFACE_SELECT_FULL}>
                            Full: {row.sourceEndpoint}
                          </MenuItem>
                          {sourceParts.map((part, idx) => (
                            <MenuItem
                              key={`${row.edgeId}-source-${idx}-${part}`}
                              value={`${INTERFACE_SELECT_TOKEN_PREFIX}${part}`}
                            >
                              Part {idx + 1}: {part}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          select
                          size="small"
                          label={row.targetEndpoint}
                          value={getInterfaceSelectionValue(
                            row.targetEndpoint,
                            interfaceLabelOverrides
                          )}
                          disabled={isReadOnly}
                          onChange={(e) => {
                            if (isReadOnly) return;
                            setTelemetryInterfaceLabelOverride(
                              row.targetEndpoint,
                              resolveInterfaceOverrideValue(row.targetEndpoint, e.target.value)
                            );
                          }}
                        >
                          <MenuItem value={INTERFACE_SELECT_AUTO}>Auto (use global)</MenuItem>
                          <MenuItem value={INTERFACE_SELECT_FULL}>
                            Full: {row.targetEndpoint}
                          </MenuItem>
                          {targetParts.map((part, idx) => (
                            <MenuItem
                              key={`${row.edgeId}-target-${idx}-${part}`}
                              value={`${INTERFACE_SELECT_TOKEN_PREFIX}${part}`}
                            >
                              Part {idx + 1}: {part}
                            </MenuItem>
                          ))}
                        </TextField>
                      </Box>
                    </Box>
                  );
                })
              )}
            </Box>
          </SettingsField>
        </>
      ) : null}
    </>
  );
};
