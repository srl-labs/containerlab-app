import React, { useCallback, useMemo } from "react";
import { shallow } from "zustand/shallow";
import Box from "@mui/material/Box";

import type { TrafficRateAnnotation } from "../../../../core/types/topology";
import { useGenericFormState } from "../../../../hooks/editor";
import { useGraphStore } from "../../../../stores/graphStore";
import type { GraphStore } from "../../../../stores/graphStore";
import { resolveComputedColor } from "../../../../utils/color";
import { getTrafficMonitorOptions } from "../../../../utils/trafficRateAnnotation";
import type { TrafficMonitorOptions } from "../../../../utils/trafficRateAnnotation";
import { CheckboxField, ColorField, InputField, PanelSection, SelectField } from "../../../ui/form";
import { FIELDSET_RESET_STYLE } from "../ContextPanelScrollArea";

import { useAnnotationLiveApply } from "./useAnnotationLiveApply";

export interface TrafficRateEditorViewProps {
  annotation: TrafficRateAnnotation | null;
  /** Live apply: update the canvas immediately, persistence is debounced downstream. */
  onApply: (annotation: TrafficRateAnnotation) => void;
  readOnly?: boolean;
}

const DEFAULT_WIDTH = 280;
const DEFAULT_HEIGHT = 170;
const DEFAULT_TEXT_WIDTH = 50;
const DEFAULT_TEXT_HEIGHT = 30;
const DEFAULT_BACKGROUND_OPACITY = 20;
const DEFAULT_BORDER_WIDTH = 1;
const DEFAULT_TEXT_BORDER_WIDTH = 0;
const DEFAULT_BORDER_RADIUS_CHART = 8;
const DEFAULT_BORDER_RADIUS_TEXT = 4;
const FALLBACK_BACKGROUND_COLOR = "#1e1e1e";
const FALLBACK_BORDER_COLOR = "#3f3f46";
const FALLBACK_TEXT_COLOR = "#9aa0a6";

type TrafficRateMode = "chart" | "text";
type TrafficRateTextMetric = "combined" | "rx" | "tx";

interface TrafficRateSizeConfig {
  defaultWidthForMode: number;
  defaultHeightForMode: number;
  defaultBorderRadiusForMode: number;
  defaultBorderWidthForMode: number;
  width: number;
  height: number;
  widthMin: number;
  heightMin: number;
}

interface TrafficRateEditorResolvedFields {
  nodeIdValue: string;
  interfaceNameValue: string;
  backgroundColorValue: string;
  borderColorValue: string;
  borderStyleValue: NonNullable<TrafficRateAnnotation["borderStyle"]>;
  textColorValue: string;
  opacityValue: string;
  borderWidthValue: string;
  borderRadiusValue: string;
  showLegendChecked: boolean;
}

// Store selectors derive only what the editor needs from the graph (node ids
// and edge endpoint options); combined with the equality functions below they
// keep the editor from re-rendering on drag-frame position changes and
// telemetry-only edge updates.
function selectTopologyNodeIds(state: GraphStore): string[] {
  const ids: string[] = [];
  for (const node of state.nodes) {
    if (node.type === "topology-node") ids.push(node.id);
  }
  return ids.sort((a, b) => a.localeCompare(b));
}

function selectTrafficMonitorOptions(state: GraphStore): TrafficMonitorOptions {
  return getTrafficMonitorOptions(state.edges);
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  return a === b || (a.length === b.length && a.every((value, index) => value === b[index]));
}

function areTrafficMonitorOptionsEqual(
  a: TrafficMonitorOptions,
  b: TrafficMonitorOptions
): boolean {
  if (a === b) return true;
  if (!areStringArraysEqual(a.nodeIds, b.nodeIds)) return false;
  if (a.interfacesByNode.size !== b.interfacesByNode.size) return false;
  for (const [nodeId, interfaces] of a.interfacesByNode) {
    const other = b.interfacesByNode.get(nodeId);
    if (other === undefined || !areStringArraysEqual(interfaces, other)) return false;
  }
  return true;
}

function getThemeTrafficRateDefaults(): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
} {
  return {
    backgroundColor: resolveComputedColor("--vscode-editor-background", FALLBACK_BACKGROUND_COLOR),
    borderColor: resolveComputedColor("--vscode-panel-border", FALLBACK_BORDER_COLOR),
    textColor: resolveComputedColor("--vscode-descriptionForeground", FALLBACK_TEXT_COLOR)
  };
}

function canApply(annotation: TrafficRateAnnotation): boolean {
  return (
    typeof annotation.nodeId === "string" &&
    annotation.nodeId.trim().length > 0 &&
    typeof annotation.interfaceName === "string" &&
    annotation.interfaceName.trim().length > 0
  );
}

function parseOptionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseClampedOrDefault(value: string, fallback: number, min: number, max: number): number {
  const parsed = parseOptionalNumber(value);
  if (parsed === undefined) return fallback;
  return clamp(parsed, min, max);
}

function resolveNodeInterfaceOptions(
  nodeId: string | undefined,
  interfacesByNode: Map<string, string[]>
): string[] {
  if (nodeId === undefined || nodeId.length === 0) return [];
  return interfacesByNode.get(nodeId) ?? [];
}

function resolveCurrentInterfaceName(
  interfaceName: TrafficRateAnnotation["interfaceName"]
): string {
  return typeof interfaceName === "string" ? interfaceName : "";
}

function resolveNextInterfaceName(availableInterfaces: string[], currentInterface: string): string {
  if (availableInterfaces.includes(currentInterface)) return currentInterface;
  return availableInterfaces[0] ?? "";
}

function resolveShowLegendValue(checked: boolean): boolean | undefined {
  if (!checked) return false;
  return undefined;
}

function resolveTrafficRateMode(mode: string | undefined): TrafficRateMode {
  return mode === "text" ? "text" : "chart";
}

function resolveTrafficRateTextMetric(textMetric: string | undefined): TrafficRateTextMetric {
  if (textMetric === "rx" || textMetric === "tx") return textMetric;
  return "combined";
}

function resolveBorderStyle(style: string): NonNullable<TrafficRateAnnotation["borderStyle"]> {
  return style === "dashed" || style === "dotted" || style === "double" ? style : "solid";
}

function resolveTrafficRateSizeConfig(
  formData: TrafficRateAnnotation,
  mode: TrafficRateMode
): TrafficRateSizeConfig {
  const defaultWidthForMode = mode === "text" ? DEFAULT_TEXT_WIDTH : DEFAULT_WIDTH;
  const defaultHeightForMode = mode === "text" ? DEFAULT_TEXT_HEIGHT : DEFAULT_HEIGHT;
  const defaultBorderRadiusForMode =
    mode === "text" ? DEFAULT_BORDER_RADIUS_TEXT : DEFAULT_BORDER_RADIUS_CHART;
  const defaultBorderWidthForMode =
    mode === "text" ? DEFAULT_TEXT_BORDER_WIDTH : DEFAULT_BORDER_WIDTH;
  const width = formData.width ?? defaultWidthForMode;
  const height = formData.height ?? defaultHeightForMode;
  const widthMin = mode === "text" ? 1 : 180;
  const heightMin = mode === "text" ? 1 : 120;
  return {
    defaultWidthForMode,
    defaultHeightForMode,
    defaultBorderRadiusForMode,
    defaultBorderWidthForMode,
    width,
    height,
    widthMin,
    heightMin
  };
}

function resolveModeFieldOverrides(
  formData: TrafficRateAnnotation,
  nextMode: TrafficRateMode
): Partial<Pick<TrafficRateAnnotation, "width" | "height" | "borderRadius" | "borderWidth">> {
  if (nextMode === "text") {
    return {
      width:
        formData.width === undefined || formData.width === DEFAULT_WIDTH
          ? DEFAULT_TEXT_WIDTH
          : undefined,
      height:
        formData.height === undefined || formData.height === DEFAULT_HEIGHT
          ? DEFAULT_TEXT_HEIGHT
          : undefined,
      borderRadius:
        formData.borderRadius === undefined || formData.borderRadius === DEFAULT_BORDER_RADIUS_CHART
          ? DEFAULT_BORDER_RADIUS_TEXT
          : undefined,
      borderWidth:
        formData.borderWidth === undefined || formData.borderWidth === DEFAULT_BORDER_WIDTH
          ? DEFAULT_TEXT_BORDER_WIDTH
          : undefined
    };
  }

  return {
    width:
      formData.width === undefined || formData.width === DEFAULT_TEXT_WIDTH
        ? DEFAULT_WIDTH
        : undefined,
    height:
      formData.height === undefined || formData.height === DEFAULT_TEXT_HEIGHT
        ? DEFAULT_HEIGHT
        : undefined,
    borderRadius:
      formData.borderRadius === undefined || formData.borderRadius === DEFAULT_BORDER_RADIUS_TEXT
        ? DEFAULT_BORDER_RADIUS_CHART
        : undefined,
    borderWidth:
      formData.borderWidth === undefined || formData.borderWidth === DEFAULT_TEXT_BORDER_WIDTH
        ? DEFAULT_BORDER_WIDTH
        : undefined
  };
}

function buildNodeSelectOptions(nodeOptions: string[]): Array<{ value: string; label: string }> {
  return [
    { value: "", label: "Select node" },
    ...nodeOptions.map((nodeId) => ({
      value: nodeId,
      label: nodeId
    }))
  ];
}

function buildInterfaceSelectOptions(
  nodeId: string | undefined,
  interfaceOptions: string[]
): Array<{ value: string; label: string }> {
  const hasNodeId = nodeId !== undefined && nodeId.length > 0;
  return [
    { value: "", label: hasNodeId ? "Select interface" : "Select node first" },
    ...interfaceOptions.map((interfaceName) => ({
      value: interfaceName,
      label: interfaceName
    }))
  ];
}

function resolveEditorResolvedFields(
  formData: TrafficRateAnnotation,
  themeDefaults: { backgroundColor: string; borderColor: string; textColor: string },
  sizeConfig: TrafficRateSizeConfig
): TrafficRateEditorResolvedFields {
  return {
    nodeIdValue: formData.nodeId ?? "",
    interfaceNameValue: formData.interfaceName ?? "",
    backgroundColorValue: formData.backgroundColor ?? themeDefaults.backgroundColor,
    borderColorValue: formData.borderColor ?? themeDefaults.borderColor,
    borderStyleValue: formData.borderStyle ?? "solid",
    textColorValue: formData.textColor ?? themeDefaults.textColor,
    opacityValue: String(formData.backgroundOpacity ?? DEFAULT_BACKGROUND_OPACITY),
    borderWidthValue: String(formData.borderWidth ?? sizeConfig.defaultBorderWidthForMode),
    borderRadiusValue: String(formData.borderRadius ?? sizeConfig.defaultBorderRadiusForMode),
    showLegendChecked: formData.showLegend !== false
  };
}

type TrafficRateUpdateField = <K extends keyof TrafficRateAnnotation>(
  field: K,
  value: TrafficRateAnnotation[K]
) => void;

function useTrafficRateNodeChangeHandler(
  formData: TrafficRateAnnotation | null,
  updateField: TrafficRateUpdateField,
  interfacesByNode: Map<string, string[]>
) {
  return useCallback(
    (nodeId: string) => {
      if (!formData) return;
      updateField("nodeId", nodeId);
      const availableInterfaces = interfacesByNode.get(nodeId) ?? [];
      const currentInterface = resolveCurrentInterfaceName(formData.interfaceName);
      updateField("interfaceName", resolveNextInterfaceName(availableInterfaces, currentInterface));
    },
    [formData, interfacesByNode, updateField]
  );
}

function applyModeOverrides(
  updateField: TrafficRateUpdateField,
  overrides: Partial<Pick<TrafficRateAnnotation, "width" | "height" | "borderRadius">>
): void {
  if (overrides.width !== undefined) updateField("width", overrides.width);
  if (overrides.height !== undefined) updateField("height", overrides.height);
  if (overrides.borderRadius !== undefined) updateField("borderRadius", overrides.borderRadius);
}

function useTrafficRateModeChangeHandler(
  formData: TrafficRateAnnotation | null,
  updateField: TrafficRateUpdateField
) {
  return useCallback(
    (value: string) => {
      if (!formData) return;
      const nextMode = resolveTrafficRateMode(value);
      updateField("mode", nextMode);
      applyModeOverrides(updateField, resolveModeFieldOverrides(formData, nextMode));
    },
    [formData, updateField]
  );
}

function cloneAnnotation(annotation: TrafficRateAnnotation): TrafficRateAnnotation {
  return { ...annotation };
}

export const TrafficRateEditorView: React.FC<TrafficRateEditorViewProps> = ({
  annotation,
  onApply,
  readOnly = false
}) => {
  const topologyNodeIds = useGraphStore(selectTopologyNodeIds, shallow);
  const trafficOptions = useGraphStore(selectTrafficMonitorOptions, areTrafficMonitorOptionsEqual);

  const { formData, updateField, formSource } = useGenericFormState(annotation);

  useAnnotationLiveApply({
    annotation,
    formData,
    formSource,
    readOnly,
    onApply,
    canApply,
    snapshot: cloneAnnotation
  });

  const nodeOptions = useMemo(() => {
    const ids = new Set<string>([...topologyNodeIds, ...trafficOptions.nodeIds]);
    return Array.from(ids).sort((a, b) => a.localeCompare(b));
  }, [topologyNodeIds, trafficOptions.nodeIds]);

  const interfaceOptions = useMemo(() => {
    return resolveNodeInterfaceOptions(formData?.nodeId, trafficOptions.interfacesByNode);
  }, [trafficOptions.interfacesByNode, formData?.nodeId]);

  const nodeSelectOptions = useMemo(() => buildNodeSelectOptions(nodeOptions), [nodeOptions]);

  const interfaceSelectOptions = useMemo(
    () => buildInterfaceSelectOptions(formData?.nodeId, interfaceOptions),
    [formData?.nodeId, interfaceOptions]
  );

  const handleNodeChange = useTrafficRateNodeChangeHandler(
    formData,
    updateField,
    trafficOptions.interfacesByNode
  );
  const handleModeChange = useTrafficRateModeChangeHandler(formData, updateField);

  if (!formData) return null;

  const mode = resolveTrafficRateMode(formData.mode);
  const textMetric = resolveTrafficRateTextMetric(formData.textMetric);
  const themeDefaults = getThemeTrafficRateDefaults();
  const sizeConfig = resolveTrafficRateSizeConfig(formData, mode);
  const resolvedFields = resolveEditorResolvedFields(formData, themeDefaults, sizeConfig);

  return (
    <Box sx={{ flex: 1, overflow: "auto" }}>
      <fieldset disabled={readOnly} style={FIELDSET_RESET_STYLE}>
        <Box sx={{ display: "flex", flexDirection: "column" }}>
          <PanelSection title="Monitor" withTopDivider={false}>
            <>
              <SelectField
                id="traffic-rate-mode"
                label="Mode"
                value={mode}
                onChange={handleModeChange}
                options={[
                  { value: "chart", label: "Chart" },
                  { value: "text", label: "Text" }
                ]}
              />
              {mode === "text" && (
                <SelectField
                  id="traffic-rate-text-metric"
                  label="Text value"
                  value={textMetric}
                  onChange={(value) =>
                    updateField("textMetric", resolveTrafficRateTextMetric(value))
                  }
                  options={[
                    { value: "combined", label: "Combined (RX + TX)" },
                    { value: "rx", label: "RX only" },
                    { value: "tx", label: "TX only" }
                  ]}
                />
              )}
              <SelectField
                id="traffic-rate-node"
                label="Node"
                value={resolvedFields.nodeIdValue}
                onChange={handleNodeChange}
                options={nodeSelectOptions}
              />
              <SelectField
                id="traffic-rate-interface"
                label="Interface"
                value={resolvedFields.interfaceNameValue}
                onChange={(value) => updateField("interfaceName", value)}
                options={interfaceSelectOptions}
                disabled={formData.nodeId === undefined || formData.nodeId.length === 0}
              />
            </>
          </PanelSection>

          <PanelSection title="Size">
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
              <InputField
                id="traffic-rate-width"
                label="Width"
                type="number"
                value={String(sizeConfig.width)}
                onChange={(value) => {
                  updateField(
                    "width",
                    parseClampedOrDefault(
                      value,
                      sizeConfig.defaultWidthForMode,
                      sizeConfig.widthMin,
                      2000
                    )
                  );
                }}
                min={sizeConfig.widthMin}
                max={2000}
                suffix="px"
              />
              <InputField
                id="traffic-rate-height"
                label="Height"
                type="number"
                value={String(sizeConfig.height)}
                onChange={(value) => {
                  updateField(
                    "height",
                    parseClampedOrDefault(
                      value,
                      sizeConfig.defaultHeightForMode,
                      sizeConfig.heightMin,
                      1200
                    )
                  );
                }}
                min={sizeConfig.heightMin}
                max={1200}
                suffix="px"
              />
            </Box>
          </PanelSection>

          <PanelSection
            title="Background"
            bodySx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, p: 2 }}
          >
            <>
              <ColorField
                label="Color"
                value={resolvedFields.backgroundColorValue}
                onChange={(value) => updateField("backgroundColor", value)}
              />
              <InputField
                id="traffic-rate-bg-opacity"
                label="Opacity"
                type="number"
                value={resolvedFields.opacityValue}
                onChange={(value) => {
                  updateField(
                    "backgroundOpacity",
                    parseClampedOrDefault(value, DEFAULT_BACKGROUND_OPACITY, 0, 100)
                  );
                }}
                min={0}
                max={100}
                suffix="%"
                clearable
              />
            </>
          </PanelSection>

          <PanelSection title="Border">
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
              <ColorField
                label="Color"
                value={resolvedFields.borderColorValue}
                onChange={(value) => updateField("borderColor", value)}
              />
              <InputField
                id="traffic-rate-border-width"
                label="Width"
                type="number"
                value={resolvedFields.borderWidthValue}
                onChange={(value) => {
                  updateField(
                    "borderWidth",
                    parseClampedOrDefault(value, sizeConfig.defaultBorderWidthForMode, 0, 20)
                  );
                }}
                min={0}
                max={20}
                step={0.5}
                suffix="px"
                clearable
              />
            </Box>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
              <SelectField
                id="traffic-rate-border-style"
                label="Style"
                value={resolvedFields.borderStyleValue}
                onChange={(value) => updateField("borderStyle", resolveBorderStyle(value))}
                options={[
                  { value: "solid", label: "Solid" },
                  { value: "dashed", label: "Dashed" },
                  { value: "dotted", label: "Dotted" },
                  { value: "double", label: "Double" }
                ]}
              />
              <InputField
                id="traffic-rate-border-radius"
                label="Corner Radius"
                type="number"
                value={resolvedFields.borderRadiusValue}
                onChange={(value) => {
                  updateField(
                    "borderRadius",
                    parseClampedOrDefault(value, sizeConfig.defaultBorderRadiusForMode, 0, 50)
                  );
                }}
                min={0}
                max={50}
                suffix="px"
                clearable
              />
            </Box>
          </PanelSection>

          <PanelSection title="Text" bodySx={{ p: 2 }}>
            <ColorField
              label="Text Color"
              value={resolvedFields.textColorValue}
              onChange={(value) => updateField("textColor", value)}
            />
          </PanelSection>

          {mode === "chart" && (
            <PanelSection title="Chart" bodySx={{ p: 2 }}>
              <CheckboxField
                id="traffic-rate-show-legend"
                label="Show legend"
                checked={resolvedFields.showLegendChecked}
                onChange={(checked) => updateField("showLegend", resolveShowLegendValue(checked))}
              />
            </PanelSection>
          )}
        </Box>
      </fieldset>
    </Box>
  );
};
