/* eslint-disable import-x/max-dependencies */
// SVG export dialog.
import React, { useState, useCallback, useMemo } from "react";
import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { IconBulb, IconDownload, IconSettings, IconSitemap } from "@tabler/icons-react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  Radio,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput
} from "@mantine/core";

import type {
  FreeTextAnnotation,
  FreeShapeAnnotation,
  GroupStyleAnnotation
} from "../../core/types/topology";
import {
  FREE_TEXT_NODE_TYPE,
  FREE_SHAPE_NODE_TYPE,
  TRAFFIC_RATE_NODE_TYPE,
  GROUP_NODE_TYPE
} from "../../annotations/annotationNodeConverters";
import { type ClabUiHost, useClabUiHost } from "../../host";
import { useEdges } from "../../stores/graphStore";
import { useTelemetryLabelSettings, useTopoViewerStore } from "../../stores/topoViewerStore";
import {
  clampTelemetryInterfaceSizePercent,
  clampTelemetryNodeSizePx
} from "../../utils/telemetryInterfaceLabels";
import { log } from "../../utils/logger";
import { ColorField, PREVIEW_GRID_BG_SX } from "../ui/form";

import {
  applyPadding,
  buildGraphSvg,
  collectGrafanaEdgeCellMappings,
  collectGrafanaTrafficRateLabelPlacements,
  collectLinkedNodeIds,
  sanitizeSvgForGrafana,
  removeUnlinkedNodesFromSvg,
  trimGrafanaSvgToTopologyContent,
  addGrafanaTrafficLegend,
  makeGrafanaSvgResponsive,
  applyGrafanaCellIdsToSvg,
  buildGrafanaPanelYaml,
  buildGrafanaDashboardJson,
  DEFAULT_GRAFANA_TRAFFIC_THRESHOLDS,
  getViewportSize,
  compositeAnnotationsIntoSvg,
  addBackgroundRect
} from "./svg-export";
import type {
  CustomIconMap,
  GrafanaTrafficThresholds,
  GraphSvgResult,
  GraphSvgRenderOptions
} from "./svg-export";
import { isRecord } from "../../core/utilities/typeHelpers";

export interface SvgExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  labName?: string;
  textAnnotations?: FreeTextAnnotation[];
  shapeAnnotations?: FreeShapeAnnotation[];
  groups?: GroupStyleAnnotation[];
  rfInstance: ReactFlowInstance | null;
  customIcons?: CustomIconMap;
}

const ANNOTATION_NODE_TYPES: Set<string> = new Set([
  FREE_TEXT_NODE_TYPE,
  FREE_SHAPE_NODE_TYPE,
  TRAFFIC_RATE_NODE_TYPE,
  GROUP_NODE_TYPE
]);

function downloadSvg(content: string, filename: string): void {
  const blob = new Blob([content], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

type BackgroundOption = "transparent" | "custom";
const DEFAULT_GRAFANA_NODE_SIZE_PX = 40;
const DEFAULT_GRAFANA_INTERFACE_SIZE_PERCENT = 100;
type TrafficThresholdUnit = "kbit" | "mbit" | "gbit";
const DEFAULT_TRAFFIC_THRESHOLD_UNIT: TrafficThresholdUnit = "mbit";
type GrafanaSettingsTab = "general" | "interface-names";

interface EdgeInterfaceRow {
  edgeId: string;
  source: string;
  target: string;
  sourceEndpoint: string;
  targetEndpoint: string;
}

const NO_INTERFACE_ROWS: EdgeInterfaceRow[] = [];

const INTERFACE_SELECT_AUTO = "__auto__";
const INTERFACE_SELECT_FULL = "__full__";
const INTERFACE_SELECT_TOKEN_PREFIX = "__token__:";
const GLOBAL_INTERFACE_PART_INDEX_PREFIX = "__part-index__:";

interface SvgExportResultMessage {
  type: "svgExportResult";
  requestId: string;
  success: boolean;
  error?: string;
  files?: string[];
}

interface GrafanaBundlePayload {
  requestId: string;
  baseName: string;
  svgContent: string;
  dashboardJson: string;
  panelYaml: string;
}

interface PreparedSvgExport {
  baseName: string;
  finalSvg: string;
  graphSvg: GraphSvgResult;
}

function createRequestId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `svg-export-${Date.now()}-${random}`;
}

function getThresholdUnitMultiplier(unit: TrafficThresholdUnit): number {
  switch (unit) {
    case "kbit":
      return 1_000;
    case "gbit":
      return 1_000_000_000;
    default:
      return 1_000_000;
  }
}

function formatThresholdForUnit(valueBps: number, unit: TrafficThresholdUnit): string {
  const multiplier = getThresholdUnitMultiplier(unit);
  if (!Number.isFinite(valueBps) || multiplier <= 0) return "0";
  const scaled = valueBps / multiplier;
  return Number(scaled.toFixed(4)).toString();
}

function parseThreshold(value: string, unit: TrafficThresholdUnit): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return 0;
  const multiplier = getThresholdUnitMultiplier(unit);
  return Math.max(0, Math.round(parsed * multiplier));
}

function getThresholdUnitStep(unit: TrafficThresholdUnit): number {
  switch (unit) {
    case "kbit":
      return 1;
    case "gbit":
      return 0.01;
    default:
      return 0.1;
  }
}

function parseBoundedNumber(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveDefaultExportBaseName(labName?: string): string {
  const trimmed = labName?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : "topology";
}

/** DOM read gated on dialog visibility so closed modals skip layout queries. */
function computeIsExportAvailable(rfInstance: ReactFlowInstance | null, isOpen: boolean): boolean {
  return isOpen && rfInstance !== null && Boolean(getViewportSize());
}

function extractEdgeInterfaceRows(edges: Edge[]): EdgeInterfaceRow[] {
  const rows: EdgeInterfaceRow[] = [];

  for (const edge of edges) {
    const data = edge.data;
    const sourceEndpoint = asNonEmptyString(data?.sourceEndpoint);
    const targetEndpoint = asNonEmptyString(data?.targetEndpoint);
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

const INTERFACE_PART_SEPARATOR_RE = /[^A-Za-z0-9]+/g;
const INTERFACE_NUMERIC_SEGMENT_RE = /\d+/g;

function splitInterfaceParts(endpoint: string): string[] {
  const baseParts = endpoint
    .split(INTERFACE_PART_SEPARATOR_RE)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const uniqueParts: string[] = [];
  const seen = new Set<string>();
  const addUnique = (part: string): void => {
    if (seen.has(part)) return;
    seen.add(part);
    uniqueParts.push(part);
  };

  for (const part of baseParts) {
    addUnique(part);

    const numericSegments = part.match(INTERFACE_NUMERIC_SEGMENT_RE);
    if (!numericSegments) continue;
    for (const numeric of numericSegments) {
      addUnique(numeric);
    }
  }

  return uniqueParts;
}

function getInterfaceSelectionValue(
  endpoint: string,
  interfaceLabelOverrides: Record<string, string>
): string {
  const override = interfaceLabelOverrides[endpoint];
  if (typeof override !== "string" || override.length === 0) {
    return INTERFACE_SELECT_AUTO;
  }
  if (override === endpoint) return INTERFACE_SELECT_FULL;
  return `${INTERFACE_SELECT_TOKEN_PREFIX}${override}`;
}

function parseBackgroundOption(value: string): BackgroundOption {
  return value === "custom" ? "custom" : "transparent";
}

function parseGrafanaSettingsTab(value: unknown): GrafanaSettingsTab {
  return value === "interface-names" ? "interface-names" : "general";
}

function parseTrafficThresholdUnit(value: string): TrafficThresholdUnit {
  if (value === "kbit" || value === "mbit" || value === "gbit") return value;
  return DEFAULT_TRAFFIC_THRESHOLD_UNIT;
}

function isSvgExportResultMessage(value: unknown): value is SvgExportResultMessage {
  if (!isRecord(value)) return false;
  if (value.type !== "svgExportResult") return false;
  if (asNonEmptyString(value.requestId) === null) return false;
  if (typeof value.success !== "boolean") return false;
  if (value.error !== undefined && typeof value.error !== "string") return false;
  if (value.files !== undefined && !Array.isArray(value.files)) return false;
  return true;
}

function resolveInterfaceOverrideValue(endpoint: string, selectedValue: string): string | null {
  if (selectedValue === INTERFACE_SELECT_AUTO) return null;
  if (selectedValue === INTERFACE_SELECT_FULL) return endpoint;
  if (selectedValue.startsWith(INTERFACE_SELECT_TOKEN_PREFIX)) {
    const token = selectedValue.slice(INTERFACE_SELECT_TOKEN_PREFIX.length).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}

function parseGlobalInterfacePartIndex(selectedValue: string): number | null {
  if (!selectedValue.startsWith(GLOBAL_INTERFACE_PART_INDEX_PREFIX)) return null;
  const raw = selectedValue.slice(GLOBAL_INTERFACE_PART_INDEX_PREFIX.length);
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

function resolveGlobalInterfaceOverrideValue(
  endpoint: string,
  selectedValue: string
): string | null {
  if (selectedValue === INTERFACE_SELECT_AUTO) return null;
  if (selectedValue === INTERFACE_SELECT_FULL) return endpoint;

  const partIndex = parseGlobalInterfacePartIndex(selectedValue);
  if (partIndex === null) return null;

  const parts = splitInterfaceParts(endpoint);
  return parts[partIndex - 1] ?? null;
}

function hasStrictlyAscendingThresholds(thresholds: GrafanaTrafficThresholds): boolean {
  return (
    thresholds.green < thresholds.yellow &&
    thresholds.yellow < thresholds.orange &&
    thresholds.orange < thresholds.red
  );
}

function requestGrafanaBundleExport(
  host: ClabUiHost,
  payload: GrafanaBundlePayload
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {
      /* no-op until subscription is active */
    };

    const timeoutId = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out waiting for export confirmation"));
    }, 30_000);

    unsubscribe = host.topoViewer.subscribe((event) => {
      if (!isSvgExportResultMessage(event)) return;
      if (event.requestId !== payload.requestId) return;

      unsubscribe();
      window.clearTimeout(timeoutId);

      if (!event.success) {
        reject(new Error(event.error ?? "Grafana bundle export failed"));
        return;
      }

      const files = Array.isArray(event.files)
        ? event.files.filter((file): file is string => typeof file === "string")
        : [];
      resolve(files);
    });

    host.topoViewer.exportGrafanaBundle({
      requestId: payload.requestId,
      baseName: payload.baseName,
      svgContent: payload.svgContent,
      dashboardJson: payload.dashboardJson,
      panelYaml: payload.panelYaml
    });
  });
}

export const SvgExportModal: React.FC<SvgExportModalProps> = ({
  isOpen,
  onClose,
  labName,
  textAnnotations = [],
  shapeAnnotations = [],
  groups = [],
  rfInstance,
  customIcons
}) => {
  const host = useClabUiHost();
  const linkLabelMode = useTopoViewerStore((state) => state.linkLabelMode);
  const telemetryLabelSettings = useTelemetryLabelSettings();
  const [borderZoom, setBorderZoom] = useState(100);
  const [borderPadding, setBorderPadding] = useState(0);
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [grafanaSettingsTab, setGrafanaSettingsTab] = useState<GrafanaSettingsTab>("general");
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  // Default to what the canvas currently shows: no labels in "hide"/"on-select" modes
  const [includeEdgeLabels, setIncludeEdgeLabels] = useState(
    () => linkLabelMode !== "hide" && linkLabelMode !== "on-select"
  );
  const [exportGrafanaBundle, setExportGrafanaBundle] = useState(false);
  const [isGrafanaSettingsOpen, setIsGrafanaSettingsOpen] = useState(false);
  const [excludeNodesWithoutLinks, setExcludeNodesWithoutLinks] = useState(true);
  const [includeGrafanaLegend, setIncludeGrafanaLegend] = useState(false);
  const [trafficRatesOnHoverOnly, setTrafficRatesOnHoverOnly] = useState(false);
  const [includeHideRatesLegendToggle, setIncludeHideRatesLegendToggle] = useState(true);
  const [trafficThresholds, setTrafficThresholds] = useState<GrafanaTrafficThresholds>({
    ...DEFAULT_GRAFANA_TRAFFIC_THRESHOLDS
  });
  const [trafficThresholdUnit, setTrafficThresholdUnit] = useState<TrafficThresholdUnit>(
    DEFAULT_TRAFFIC_THRESHOLD_UNIT
  );
  // Start from the live canvas sizing so Grafana bundles match the screen too
  const [grafanaNodeSizePx, setGrafanaNodeSizePx] = useState(() =>
    clampTelemetryNodeSizePx(telemetryLabelSettings.nodeSizePx)
  );
  const [grafanaInterfaceSizePercent, setGrafanaInterfaceSizePercent] = useState(() =>
    clampTelemetryInterfaceSizePercent(telemetryLabelSettings.interfaceSizePercent)
  );
  const [globalInterfaceOverrideSelection, setGlobalInterfaceOverrideSelection] =
    useState(INTERFACE_SELECT_AUTO);
  const [interfaceLinkFilter, setInterfaceLinkFilter] = useState("");
  const [interfaceLabelOverrides, setInterfaceLabelOverrides] = useState<Record<string, string>>(
    {}
  );
  const [backgroundOption, setBackgroundOption] = useState<BackgroundOption>("transparent");
  const [customBackgroundColor, setCustomBackgroundColor] = useState("#1e1e1e");
  const defaultBaseName = useMemo(() => resolveDefaultExportBaseName(labName), [labName]);
  const [filename, setFilename] = useState(defaultBaseName);

  const isExportAvailable = computeIsExportAvailable(rfInstance, isOpen);
  const totalAnnotations = groups.length + textAnnotations.length + shapeAnnotations.length;
  const edges = useEdges();
  // Rows derived from the edges store subscription so they stay fresh on external
  // edge changes; memoized on the edges array so keystrokes in the dialog don't
  // recompute them. Still gated on dialog visibility so closed modals skip the scan.
  const interfaceRows = useMemo(() => {
    if (!isOpen && !isGrafanaSettingsOpen) return NO_INTERFACE_ROWS;
    return extractEdgeInterfaceRows(edges);
  }, [edges, isOpen, isGrafanaSettingsOpen]);
  const filteredInterfaceRows = useMemo(() => {
    const filterValue = interfaceLinkFilter.trim().toLowerCase();
    if (!filterValue) return interfaceRows;

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
  const effectiveInterfaceLabelOverrides = useMemo(() => {
    const merged: Record<string, string> = {};

    for (const endpoint of interfaceEndpoints) {
      const globalOverride = resolveGlobalInterfaceOverrideValue(
        endpoint,
        globalInterfaceOverrideSelection
      );
      if (globalOverride !== null) {
        merged[endpoint] = globalOverride;
      }
    }

    for (const [endpoint, override] of Object.entries(interfaceLabelOverrides)) {
      if (typeof override !== "string" || override.trim().length === 0) {
        delete merged[endpoint];
      } else {
        merged[endpoint] = override.trim();
      }
    }

    return merged;
  }, [interfaceEndpoints, globalInterfaceOverrideSelection, interfaceLabelOverrides]);

  const updateTrafficThreshold = useCallback(
    (threshold: keyof GrafanaTrafficThresholds, rawValue: string) => {
      const nextValue = parseThreshold(rawValue, trafficThresholdUnit);
      setTrafficThresholds((prev) => ({
        ...prev,
        [threshold]: nextValue
      }));
    },
    [trafficThresholdUnit]
  );

  const updateInterfaceOverride = useCallback((endpoint: string, selectedValue: string) => {
    const override = resolveInterfaceOverrideValue(endpoint, selectedValue);
    setInterfaceLabelOverrides((prev) => {
      if (override === null) {
        if (!(endpoint in prev)) return prev;
        const next = { ...prev };
        delete next[endpoint];
        return next;
      }
      if (prev[endpoint] === override) return prev;
      return { ...prev, [endpoint]: override };
    });
  }, []);

  const prepareSvgExport = useCallback((): PreparedSvgExport => {
    if (!rfInstance) {
      throw new Error("SVG export is not yet available");
    }

    const renderOptions: GraphSvgRenderOptions = exportGrafanaBundle
      ? {
          nodeIconSize: grafanaNodeSizePx,
          interfaceScale: grafanaInterfaceSizePercent / 100,
          interfaceLabelOverrides: effectiveInterfaceLabelOverrides,
          telemetryStyleLabels: true
        }
      : {
          // Mirror the live canvas settings so the export matches the screen 1:1
          nodeIconSize: clampTelemetryNodeSizePx(telemetryLabelSettings.nodeSizePx),
          interfaceScale:
            clampTelemetryInterfaceSizePercent(telemetryLabelSettings.interfaceSizePercent) / 100,
          interfaceLabelOverrides: telemetryLabelSettings.interfaceLabelOverrides,
          globalInterfaceOverrideSelection: telemetryLabelSettings.globalInterfaceOverrideSelection,
          telemetryStyleLabels: linkLabelMode === "telemetry-style"
        };
    const graphSvg = buildGraphSvg(
      rfInstance,
      borderZoom,
      customIcons,
      includeEdgeLabels,
      ANNOTATION_NODE_TYPES,
      renderOptions
    );
    if (!graphSvg) {
      throw new Error("Unable to capture viewport for SVG export");
    }

    let finalSvg = graphSvg.svg;
    if (borderPadding > 0) finalSvg = applyPadding(finalSvg, borderPadding);
    if (includeAnnotations && totalAnnotations > 0) {
      finalSvg = compositeAnnotationsIntoSvg(
        finalSvg,
        { groups, textAnnotations, shapeAnnotations },
        borderZoom / 100
      );
    }
    if (backgroundOption === "custom") {
      finalSvg = addBackgroundRect(finalSvg, customBackgroundColor);
    }

    const baseName = filename.trim() || defaultBaseName;
    return { baseName, finalSvg, graphSvg };
  }, [
    exportGrafanaBundle,
    grafanaNodeSizePx,
    grafanaInterfaceSizePercent,
    effectiveInterfaceLabelOverrides,
    linkLabelMode,
    telemetryLabelSettings,
    rfInstance,
    borderZoom,
    customIcons,
    includeEdgeLabels,
    borderPadding,
    includeAnnotations,
    totalAnnotations,
    groups,
    textAnnotations,
    shapeAnnotations,
    backgroundOption,
    customBackgroundColor,
    filename,
    defaultBaseName
  ]);

  const exportPlainSvg = useCallback((prepared: PreparedSvgExport): void => {
    downloadSvg(prepared.finalSvg, `${prepared.baseName}.svg`);
    setExportStatus({
      type: "success",
      message: "SVG exported successfully"
    });
  }, []);

  const exportGrafanaBundleFiles = useCallback(
    async (prepared: PreparedSvgExport): Promise<void> => {
      if (!hasStrictlyAscendingThresholds(trafficThresholds)) {
        throw new Error(
          "Traffic thresholds must be strictly ascending (green < yellow < orange < red)"
        );
      }
      const mappings = collectGrafanaEdgeCellMappings(
        prepared.graphSvg.edges,
        prepared.graphSvg.nodes,
        ANNOTATION_NODE_TYPES
      );
      const trafficRateLabelPlacements = collectGrafanaTrafficRateLabelPlacements(
        prepared.graphSvg.nodes,
        mappings
      );
      let grafanaBaseSvg = sanitizeSvgForGrafana(prepared.finalSvg);
      if (excludeNodesWithoutLinks) {
        const linkedNodeIds = collectLinkedNodeIds(
          prepared.graphSvg.edges,
          prepared.graphSvg.nodes,
          ANNOTATION_NODE_TYPES
        );
        grafanaBaseSvg = removeUnlinkedNodesFromSvg(grafanaBaseSvg, linkedNodeIds);
        grafanaBaseSvg = trimGrafanaSvgToTopologyContent(
          grafanaBaseSvg,
          Math.max(6, borderPadding)
        );
      }
      let grafanaSvg = applyGrafanaCellIdsToSvg(grafanaBaseSvg, mappings, {
        trafficRatesOnHoverOnly,
        trafficRateLabelPlacements
      });
      if (includeGrafanaLegend) {
        grafanaSvg = addGrafanaTrafficLegend(grafanaSvg, trafficThresholds, trafficThresholdUnit);
      }
      grafanaSvg = makeGrafanaSvgResponsive(grafanaSvg);
      const panelYaml = buildGrafanaPanelYaml(mappings, {
        trafficThresholds,
        includeHideRatesLegendToggle,
        trafficRateLabelPlacements
      });
      const dashboardJson = buildGrafanaDashboardJson(panelYaml, grafanaSvg, prepared.baseName);

      const requestId = createRequestId();
      const files = await requestGrafanaBundleExport(host, {
        requestId,
        baseName: prepared.baseName,
        svgContent: grafanaSvg,
        dashboardJson,
        panelYaml
      });
      const suffix =
        files.length > 0 ? ` (${files.map((file) => file.split("/").pop()).join(", ")})` : "";
      setExportStatus({
        type: "success",
        message: `Grafana bundle exported successfully${suffix}`
      });
    },
    [
      trafficThresholds,
      excludeNodesWithoutLinks,
      borderPadding,
      includeGrafanaLegend,
      trafficRatesOnHoverOnly,
      includeHideRatesLegendToggle,
      trafficThresholdUnit,
      host
    ]
  );

  const handleExport = useCallback(async () => {
    if (!isExportAvailable || !rfInstance) {
      setExportStatus({
        type: "error",
        message: "SVG export is not yet available"
      });
      return;
    }
    setIsExporting(true);
    setExportStatus(null);
    try {
      log.info(`[SvgExport] Export requested: zoom=${borderZoom}%, padding=${borderPadding}px`);
      const prepared = prepareSvgExport();
      if (!exportGrafanaBundle) {
        exportPlainSvg(prepared);
        return;
      }
      await exportGrafanaBundleFiles(prepared);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error(`[SvgExport] Export failed: ${errorMessage}`);
      setExportStatus({
        type: "error",
        message: `Export failed: ${errorMessage}`
      });
    } finally {
      setIsExporting(false);
    }
  }, [
    isExportAvailable,
    borderZoom,
    borderPadding,
    exportGrafanaBundle,
    rfInstance,
    prepareSvgExport,
    exportPlainSvg,
    exportGrafanaBundleFiles
  ]);

  const previewBackgroundSx = (() => {
    if (backgroundOption === "transparent") {
      return {
        backgroundImage:
          "linear-gradient(45deg, #444 25%, transparent 25%), linear-gradient(-45deg, #444 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #444 75%), linear-gradient(-45deg, transparent 75%, #444 75%)",
        backgroundSize: "8px 8px",
        backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px"
      } as const;
    }
    return { backgroundColor: customBackgroundColor } as const;
  })();

  let exportButtonLabel = "Export SVG";
  if (isExporting) {
    exportButtonLabel = "Exporting...";
  } else if (exportGrafanaBundle) {
    exportButtonLabel = "Export Grafana Bundle";
  }

  return (
    <>
      <Modal
        opened={isOpen}
        onClose={onClose}
        title="Export SVG"
        size="lg"
        centered
        data-testid="svg-export-modal"
        styles={{ body: { padding: 0 } }}
      >
        <Box style={{ padding: 16 }}>
          <TextInput
            label="Filename"
            value={filename}
            onChange={(e) => setFilename(e.currentTarget.value)}
            placeholder={defaultBaseName}
            data-testid="svg-export-filename"
            rightSection={
              <Text size="xs" c="dimmed">
                .svg
              </Text>
            }
            rightSectionWidth={40}
          />
        </Box>

        <Divider />
        <Box style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}>
          <Text size="sm" fw={600}>
            Quality & Size
          </Text>
        </Box>
        <Divider />
        <Box style={{ padding: 16 }}>
          <Box style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <NumberInput
              label="Zoom"
              value={borderZoom}
              onChange={(v) =>
                setBorderZoom(
                  Math.max(10, Math.min(300, typeof v === "number" ? v : parseFloat(v) || 0))
                )
              }
              min={10}
              max={300}
              step={1}
              suffix="%"
            />
            <NumberInput
              label="Padding"
              value={borderPadding}
              onChange={(v) =>
                setBorderPadding(Math.max(0, typeof v === "number" ? v : parseFloat(v) || 0))
              }
              min={0}
              max={500}
              step={1}
              suffix="px"
            />
          </Box>
        </Box>

        <Divider />
        <Box style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}>
          <Text size="sm" fw={600}>
            Background
          </Text>
        </Box>
        <Divider />
        <Box
          style={{
            display: "flex",
            flexDirection: "column",
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 8,
            paddingBottom: 8
          }}
        >
          <Radio.Group
            value={backgroundOption}
            onChange={(v) => setBackgroundOption(parseBackgroundOption(v))}
          >
            <Stack gap="xs">
              <Radio value="transparent" label="Transparent" size="sm" />
              <Radio value="custom" label="Custom" size="sm" />
            </Stack>
          </Radio.Group>
          {backgroundOption === "custom" && (
            <Box style={{ paddingLeft: 32, paddingTop: 8 }}>
              <ColorField
                label="Color"
                value={customBackgroundColor}
                onChange={setCustomBackgroundColor}
              />
            </Box>
          )}
        </Box>

        <Divider />
        <Box style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}>
          <Text size="sm" fw={600}>
            Include
          </Text>
        </Box>
        <Divider />
        <Box
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            paddingLeft: 16,
            paddingRight: 16,
            paddingTop: 8,
            paddingBottom: 8
          }}
        >
          <Checkbox
            size="sm"
            checked={includeAnnotations}
            onChange={(e) => setIncludeAnnotations(e.currentTarget.checked)}
            label="Annotations"
          />
          <Checkbox
            size="sm"
            checked={includeEdgeLabels}
            onChange={(e) => setIncludeEdgeLabels(e.currentTarget.checked)}
            label="Edge labels"
          />
          <Box
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8
            }}
          >
            <Checkbox
              size="sm"
              checked={exportGrafanaBundle}
              onChange={(e) => setExportGrafanaBundle(e.currentTarget.checked)}
              label="Grafana bundle"
              data-testid="svg-export-grafana-bundle"
            />
            <Button
              size="xs"
              variant="default"
              leftSection={<IconSettings size={20} />}
              disabled={!exportGrafanaBundle}
              onClick={() => setIsGrafanaSettingsOpen(true)}
              data-testid="svg-export-grafana-advanced-btn"
            >
              Advanced Grafana Settings
            </Button>
          </Box>
        </Box>

        <Divider />
        <Box style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 8, paddingBottom: 8 }}>
          <Text size="sm" fw={600}>
            Preview
          </Text>
        </Box>
        <Divider />
        <Box style={{ padding: 16 }}>
          <Box
            style={{
              position: "relative",
              padding: 16,
              borderRadius: 4,
              overflow: "hidden",
              border: "1px solid var(--mantine-color-default-border)"
            }}
          >
            <Box
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0.3,
                ...PREVIEW_GRID_BG_SX
              }}
            />
            <Box
              style={{
                position: "relative",
                zIndex: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              }}
            >
              <Box
                style={{
                  width: 96,
                  height: 64,
                  borderRadius: 4,
                  boxShadow: "var(--mantine-shadow-md)",
                  border: "1px solid var(--mantine-color-default-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 200ms",
                  ...previewBackgroundSx,
                  padding: `${Math.min(borderPadding / 20, 8)}px`,
                  transform: `scale(${0.8 + borderZoom / 500})`
                }}
              >
                <IconSitemap
                  size={24}
                  style={{ color: "var(--mantine-primary-color-filled)", opacity: 0.8 }}
                />
              </Box>
            </Box>
          </Box>
        </Box>

        <Divider />
        <Box style={{ padding: 16 }}>
          <Paper withBorder p="sm">
            <Box style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <IconBulb size={14} style={{ color: "var(--mantine-color-yellow-6)" }} />
              <Text size="xs" c="dimmed">
                Tips
              </Text>
            </Box>
            <Text size="xs" c="dimmed" component="ul" style={{ paddingLeft: 16, margin: 0 }}>
              <li>Higher zoom = better quality, larger file</li>
              <li>SVG files scale without quality loss</li>
              <li>Transparent background for layering</li>
            </Text>
          </Paper>
        </Box>

        {exportStatus && (
          <Box style={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 16 }}>
            <Alert color={exportStatus.type === "success" ? "green" : "red"} variant="outline">
              {exportStatus.message}
            </Alert>
          </Box>
        )}

        <Box style={{ padding: 16 }}>
          <Button
            fullWidth
            variant="subtle"
            onClick={() => void handleExport()}
            disabled={isExporting || !isExportAvailable}
            leftSection={isExporting ? <Loader size={16} /> : <IconDownload size={20} />}
            data-testid="svg-export-btn"
          >
            {exportButtonLabel}
          </Button>
        </Box>
      </Modal>

      <Modal
        opened={isGrafanaSettingsOpen}
        onClose={() => setIsGrafanaSettingsOpen(false)}
        title="Advanced Grafana Settings"
        size="lg"
        centered
        data-testid="svg-export-grafana-settings-modal"
      >
        <Stack gap="md">
          <Tabs
            value={grafanaSettingsTab}
            onChange={(value) => setGrafanaSettingsTab(parseGrafanaSettingsTab(value))}
          >
            <Tabs.List grow>
              <Tabs.Tab value="general">General</Tabs.Tab>
              <Tabs.Tab value="interface-names">Interface Names</Tabs.Tab>
            </Tabs.List>
          </Tabs>

          {grafanaSettingsTab === "general" && (
            <>
              <Text size="sm" c="dimmed">
                Configure thresholds and topology sizing used in the exported Grafana panel.
              </Text>
              <Box style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <NumberInput
                  label="Node size"
                  value={grafanaNodeSizePx}
                  onChange={(v) =>
                    setGrafanaNodeSizePx(
                      parseBoundedNumber(String(v), 12, 240, DEFAULT_GRAFANA_NODE_SIZE_PX)
                    )
                  }
                  min={12}
                  max={240}
                  step={1}
                  suffix="px"
                />
                <NumberInput
                  label="Interface size"
                  value={grafanaInterfaceSizePercent}
                  onChange={(v) =>
                    setGrafanaInterfaceSizePercent(
                      parseBoundedNumber(
                        String(v),
                        40,
                        400,
                        DEFAULT_GRAFANA_INTERFACE_SIZE_PERCENT
                      )
                    )
                  }
                  min={40}
                  max={400}
                  step={5}
                  suffix="%"
                />
              </Box>
              <Text size="xs" c="dimmed">
                Use larger values for dense topologies with many interfaces.
              </Text>
              <Divider />
              <Select
                label="Traffic threshold unit"
                value={trafficThresholdUnit}
                onChange={(v) => setTrafficThresholdUnit(parseTrafficThresholdUnit(v ?? ""))}
                allowDeselect={false}
                data={[
                  { value: "kbit", label: "kbit/s" },
                  { value: "mbit", label: "Mbit/s" },
                  { value: "gbit", label: "Gbit/s" }
                ]}
              />
              <Box style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <NumberInput
                  label="Green threshold"
                  value={formatThresholdForUnit(trafficThresholds.green, trafficThresholdUnit)}
                  onChange={(v) => updateTrafficThreshold("green", String(v))}
                  min={0}
                  step={getThresholdUnitStep(trafficThresholdUnit)}
                />
                <NumberInput
                  label="Yellow threshold"
                  value={formatThresholdForUnit(trafficThresholds.yellow, trafficThresholdUnit)}
                  onChange={(v) => updateTrafficThreshold("yellow", String(v))}
                  min={0}
                  step={getThresholdUnitStep(trafficThresholdUnit)}
                />
                <NumberInput
                  label="Orange threshold"
                  value={formatThresholdForUnit(trafficThresholds.orange, trafficThresholdUnit)}
                  onChange={(v) => updateTrafficThreshold("orange", String(v))}
                  min={0}
                  step={getThresholdUnitStep(trafficThresholdUnit)}
                />
                <NumberInput
                  label="Red threshold"
                  value={formatThresholdForUnit(trafficThresholds.red, trafficThresholdUnit)}
                  onChange={(v) => updateTrafficThreshold("red", String(v))}
                  min={0}
                  step={getThresholdUnitStep(trafficThresholdUnit)}
                />
              </Box>
              <Text size="xs" c="dimmed">
                Values must be strictly ascending: green &lt; yellow &lt; orange &lt; red (within
                selected unit).
              </Text>
              <Checkbox
                size="sm"
                checked={excludeNodesWithoutLinks}
                onChange={(e) => setExcludeNodesWithoutLinks(e.currentTarget.checked)}
                label="Exclude nodes without any links"
              />
              <Checkbox
                size="sm"
                checked={includeGrafanaLegend}
                onChange={(e) => setIncludeGrafanaLegend(e.currentTarget.checked)}
                label="Add traffic legend (top-left)"
              />
              <Checkbox
                size="sm"
                checked={trafficRatesOnHoverOnly}
                onChange={(e) => setTrafficRatesOnHoverOnly(e.currentTarget.checked)}
                label="Show traffic rates on hover only"
              />
              <Checkbox
                size="sm"
                checked={includeHideRatesLegendToggle}
                onChange={(e) => setIncludeHideRatesLegendToggle(e.currentTarget.checked)}
                label='Add "hide-rates" legend toggle for rate labels'
              />
            </>
          )}

          {grafanaSettingsTab === "interface-names" && (
            <>
              <Text size="sm" c="dimmed">
                Filter links and choose which interface segment should be shown in endpoint bubbles.
              </Text>
              <Select
                label="Global override (all interfaces)"
                value={globalInterfaceOverrideSelection}
                onChange={(v) => setGlobalInterfaceOverrideSelection(v ?? INTERFACE_SELECT_AUTO)}
                allowDeselect={false}
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
              />
              <Text size="xs" c="dimmed">
                Default for every interface; per-link overrides below take precedence.
              </Text>
              <TextInput
                label="Filter links"
                placeholder="Search node or interface name"
                value={interfaceLinkFilter}
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
                  <Paper withBorder p="sm">
                    <Text size="xs" c="dimmed">
                      No links match the current filter.
                    </Text>
                  </Paper>
                ) : (
                  filteredInterfaceRows.map((row) => {
                    const sourceParts = splitInterfaceParts(row.sourceEndpoint);
                    const targetParts = splitInterfaceParts(row.targetEndpoint);

                    return (
                      <Paper key={row.edgeId} withBorder p="sm">
                        <Text size="xs" c="dimmed">
                          {row.source} ↔ {row.target}
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
                            label={row.sourceEndpoint}
                            value={getInterfaceSelectionValue(
                              row.sourceEndpoint,
                              interfaceLabelOverrides
                            )}
                            onChange={(v) =>
                              updateInterfaceOverride(row.sourceEndpoint, v ?? INTERFACE_SELECT_AUTO)
                            }
                            allowDeselect={false}
                            data={[
                              { value: INTERFACE_SELECT_AUTO, label: "Auto (use global)" },
                              { value: INTERFACE_SELECT_FULL, label: `Full: ${row.sourceEndpoint}` },
                              ...sourceParts.map((part, idx) => ({
                                value: `${INTERFACE_SELECT_TOKEN_PREFIX}${part}`,
                                label: `Part ${idx + 1}: ${part}`
                              }))
                            ]}
                          />
                          <Select
                            label={row.targetEndpoint}
                            value={getInterfaceSelectionValue(
                              row.targetEndpoint,
                              interfaceLabelOverrides
                            )}
                            onChange={(v) =>
                              updateInterfaceOverride(row.targetEndpoint, v ?? INTERFACE_SELECT_AUTO)
                            }
                            allowDeselect={false}
                            data={[
                              { value: INTERFACE_SELECT_AUTO, label: "Auto (use global)" },
                              { value: INTERFACE_SELECT_FULL, label: `Full: ${row.targetEndpoint}` },
                              ...targetParts.map((part, idx) => ({
                                value: `${INTERFACE_SELECT_TOKEN_PREFIX}${part}`,
                                label: `Part ${idx + 1}: ${part}`
                              }))
                            ]}
                          />
                        </Box>
                      </Paper>
                    );
                  })
                )}
              </Box>
            </>
          )}
        </Stack>
        <Group justify="flex-end" mt="md">
          <Button variant="subtle" onClick={() => setIsGrafanaSettingsOpen(false)}>
            Done
          </Button>
        </Group>
      </Modal>
    </>
  );
};
