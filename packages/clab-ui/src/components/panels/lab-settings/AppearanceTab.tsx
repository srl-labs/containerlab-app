/* eslint-disable import-x/max-dependencies */
import React, { useEffect, useMemo, useState } from "react";
import type { Edge } from "@xyflow/react";
import { IconCheck, IconRestore } from "@tabler/icons-react";
import {
  Box,
  Button,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput
} from "@mantine/core";

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
import { invertHexColor, resolveComputedColor } from "../../../utils/color";
import type { GridSettingsControlsProps } from "../GridSettingsPopover";
import { ColorField, InputField } from "../../ui/form";

interface EdgeInterfaceRow {
  edgeId: string;
  source: string;
  target: string;
  sourceEndpoint: string;
  targetEndpoint: string;
}

interface AppearanceTabProps extends GridSettingsControlsProps {
  /** "style" renders the link/telemetry appearance controls, "grid" the canvas grid controls. */
  section: "style" | "grid";
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

function isGridStyle(value: unknown): value is GridSettingsControlsProps["gridStyle"] {
  return value === "dotted" || value === "quadratic";
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
  section,
  gridLineWidth,
  onGridLineWidthChange,
  gridStyle,
  onGridStyleChange,
  gridColor,
  onGridColorChange,
  gridBgColor,
  onGridBgColorChange,
  onResetGridColors,
  isReadOnly,
  showRateLabels,
  onShowRateLabelsChange
}) => {
  const edges = useEdges();
  const [interfaceLinkFilter, setInterfaceLinkFilter] = useState("");
  const [themeBgColor, setThemeBgColor] = useState("#1e1e1e");

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
  const hasCustomGridColors = gridColor !== null || gridBgColor !== null;

  useEffect(() => {
    setThemeBgColor(resolveComputedColor("--vscode-editor-background", "#1e1e1e"));
  }, []);

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

  const effectiveGridBgColor = gridBgColor ?? themeBgColor;
  const defaultGridColor = invertHexColor(effectiveGridBgColor);

  return (
    <Box style={{ display: "flex", flexDirection: "column" }}>
      {section === "style" ? (
        <Box style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16 }}>
          <Select
            size="sm"
            label="Style"
            value={telemetryStyleValue}
            disabled={isReadOnly}
            allowDeselect={false}
            comboboxProps={{ withinPortal: true }}
            data={[
              { value: "default", label: "Default" },
              { value: "telemetry-style", label: "Telemetry Style" }
            ]}
            onChange={(value) => {
              if (isReadOnly || value === null) return;
              const nextLinkLabelMode =
                value === "telemetry-style" ? "telemetry-style" : lastNonTelemetryLinkLabelMode;
              setLinkLabelMode(nextLinkLabelMode);
            }}
            data-testid="lab-settings-telemetry-style"
          />

          <Box style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <InputField
              id="telemetry-node-size"
              label="Node size"
              type="number"
              value={String(telemetryNodeSizePx)}
              min={12}
              max={240}
              step={1}
              suffix="px"
              disabled={isReadOnly}
              onChange={(value) => {
                if (isReadOnly) return;
                const nextTelemetryNodeSizePx = clampTelemetryNodeSizePx(
                  parseBoundedNumber(value, 12, 240, DEFAULT_TELEMETRY_NODE_SIZE_PX)
                );
                setTelemetryNodeSizePx(nextTelemetryNodeSizePx);
              }}
            />
            <InputField
              id="telemetry-interface-size"
              label="Interface size"
              type="number"
              value={String(telemetryInterfaceSizePercent)}
              min={40}
              max={400}
              step={5}
              suffix="%"
              disabled={isReadOnly}
              onChange={(value) => {
                if (isReadOnly) return;
                const nextTelemetryInterfaceSizePercent = clampTelemetryInterfaceSizePercent(
                  parseBoundedNumber(value, 40, 400, DEFAULT_TELEMETRY_INTERFACE_SIZE_PERCENT)
                );
                setTelemetryInterfaceSizePercent(nextTelemetryInterfaceSizePercent);
              }}
            />
          </Box>

          <Paper
            withBorder
            style={{
              paddingInline: 12,
              paddingBlock: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              minHeight: 40
            }}
          >
            <Text id="show-rate-labels-label" size="sm" style={{ minWidth: 0 }}>
              Show rate labels
            </Text>
            <Switch
              size="sm"
              checked={showRateLabels}
              disabled={isReadOnly}
              aria-labelledby="show-rate-labels-label"
              onChange={(e) => {
                if (isReadOnly) return;
                onShowRateLabelsChange(e.currentTarget.checked);
              }}
              style={{ flexShrink: 0 }}
            />
          </Paper>

          {isTelemetryStyleEnabled ? (
            <>
              <Select
                size="sm"
                label="Global override (all interfaces)"
                value={globalInterfaceOverrideSelection}
                disabled={isReadOnly}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
                data={[
                  { value: INTERFACE_SELECT_AUTO, label: "Auto" },
                  { value: INTERFACE_SELECT_FULL, label: "Full interface name" },
                  ...Array.from({ length: maxInterfacePartCount }, (_, index) => index + 1).map(
                    (partIndex) => ({
                      value: `${GLOBAL_INTERFACE_PART_INDEX_PREFIX}${partIndex}`,
                      label: `Part ${partIndex}`
                    })
                  )
                ]}
                onChange={(value) => {
                  if (isReadOnly || value === null) return;
                  setTelemetryGlobalInterfaceOverrideSelection(value);
                }}
              />
              <TextInput
                size="sm"
                label="Filter links"
                placeholder="Search node or interface name"
                value={interfaceLinkFilter}
                disabled={isReadOnly}
                onChange={(e) => setInterfaceLinkFilter(e.currentTarget.value)}
              />
              <Text size="xs" c="dimmed">
                {filteredInterfaceRows.length} of {interfaceRows.length} links shown
              </Text>
              <Box
                style={{
                  maxHeight: 360,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8
                }}
              >
                {filteredInterfaceRows.length === 0 ? (
                  <Paper withBorder style={{ padding: 12 }}>
                    <Text size="xs" c="dimmed">
                      No links match the current filter.
                    </Text>
                  </Paper>
                ) : (
                  filteredInterfaceRows.map((row) => {
                    const sourceParts = splitInterfaceParts(row.sourceEndpoint);
                    const targetParts = splitInterfaceParts(row.targetEndpoint);
                    return (
                      <Paper key={row.edgeId} withBorder style={{ padding: 12 }}>
                        <Text size="xs" c="dimmed">
                          {row.source} {"<->"} {row.target}
                        </Text>
                        <Box
                          style={{
                            marginTop: 8,
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: 8
                          }}
                        >
                          <Select
                            size="sm"
                            label={row.sourceEndpoint}
                            allowDeselect={false}
                            comboboxProps={{ withinPortal: true }}
                            value={getInterfaceSelectionValue(
                              row.sourceEndpoint,
                              interfaceLabelOverrides
                            )}
                            disabled={isReadOnly}
                            data={[
                              { value: INTERFACE_SELECT_AUTO, label: "Auto (use global)" },
                              { value: INTERFACE_SELECT_FULL, label: `Full: ${row.sourceEndpoint}` },
                              ...sourceParts.map((part, idx) => ({
                                value: `${INTERFACE_SELECT_TOKEN_PREFIX}${part}`,
                                label: `Part ${idx + 1}: ${part}`
                              }))
                            ]}
                            onChange={(value) => {
                              if (isReadOnly || value === null) return;
                              setTelemetryInterfaceLabelOverride(
                                row.sourceEndpoint,
                                resolveInterfaceOverrideValue(row.sourceEndpoint, value)
                              );
                            }}
                          />
                          <Select
                            size="sm"
                            label={row.targetEndpoint}
                            allowDeselect={false}
                            comboboxProps={{ withinPortal: true }}
                            value={getInterfaceSelectionValue(
                              row.targetEndpoint,
                              interfaceLabelOverrides
                            )}
                            disabled={isReadOnly}
                            data={[
                              { value: INTERFACE_SELECT_AUTO, label: "Auto (use global)" },
                              { value: INTERFACE_SELECT_FULL, label: `Full: ${row.targetEndpoint}` },
                              ...targetParts.map((part, idx) => ({
                                value: `${INTERFACE_SELECT_TOKEN_PREFIX}${part}`,
                                label: `Part ${idx + 1}: ${part}`
                              }))
                            ]}
                            onChange={(value) => {
                              if (isReadOnly || value === null) return;
                              setTelemetryInterfaceLabelOverride(
                                row.targetEndpoint,
                                resolveInterfaceOverrideValue(row.targetEndpoint, value)
                              );
                            }}
                          />
                        </Box>
                      </Paper>
                    );
                  })
                )}
              </Box>
            </>
          ) : null}
        </Box>
      ) : null}

      {section === "grid" ? (
        <Stack data-testid="lab-settings-grid-settings" gap={24} p={24}>
          <Box>
            <Text size="sm" fw={600}>
              Stroke Width
            </Text>
            <Box style={{ marginTop: 4 }}>
              <InputField
                id="lab-settings-grid-line-width"
                type="number"
                value={String(gridLineWidth)}
                min={0}
                max={2}
                step={0.1}
                disabled={isReadOnly}
                onChange={(value) => {
                  if (isReadOnly) return;
                  onGridLineWidthChange(parseBoundedNumber(value, 0, 2, gridLineWidth));
                }}
              />
            </Box>
          </Box>

          <Box>
            <Text size="sm" fw={600}>
              Grid Style
            </Text>
            <SegmentedControl
              data-testid="lab-settings-grid-style"
              value={gridStyle}
              disabled={isReadOnly}
              onChange={(value) => {
                if (isReadOnly) return;
                if (isGridStyle(value)) {
                  onGridStyleChange(value);
                }
              }}
              size="sm"
              fullWidth
              mt={4}
              data={[
                {
                  value: "dotted",
                  label: (
                    <>
                      {gridStyle === "dotted" ? (
                        <IconCheck size={18} style={{ marginRight: 4 }} />
                      ) : null}
                      Dotted
                    </>
                  )
                },
                {
                  value: "quadratic",
                  label: (
                    <>
                      {gridStyle === "quadratic" ? (
                        <IconCheck size={18} style={{ marginRight: 4 }} />
                      ) : null}
                      Quadratic
                    </>
                  )
                }
              ]}
            />
          </Box>

          <Box>
            <Text size="sm" fw={600}>
              Grid Color
            </Text>
            <Box style={{ marginTop: 4 }}>
              <ColorField
                value={gridColor ?? defaultGridColor}
                disabled={isReadOnly}
                onChange={(value) => onGridColorChange(value)}
              />
            </Box>
          </Box>

          <Box>
            <Text size="sm" fw={600}>
              Background Color
            </Text>
            <Box style={{ marginTop: 4 }}>
              <ColorField
                value={gridBgColor ?? themeBgColor}
                disabled={isReadOnly}
                onChange={(value) => onGridBgColorChange(value)}
              />
            </Box>
          </Box>

          {hasCustomGridColors ? (
            <Button
              size="xs"
              variant="subtle"
              leftSection={<IconRestore size={20} />}
              disabled={isReadOnly}
              onClick={onResetGridColors}
              style={{ alignSelf: "flex-start" }}
            >
              Reset to theme colors
            </Button>
          ) : null}
        </Stack>
      ) : null}
    </Box>
  );
};
