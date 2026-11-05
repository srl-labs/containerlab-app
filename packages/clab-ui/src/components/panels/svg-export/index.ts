// SVG export barrel.

// Node rendering
export type { CustomIconMap } from "./nodesToSvg";

// Annotation rendering (existing)
export { compositeAnnotationsIntoSvg, addBackgroundRect } from "./annotationsToSvg";

// Graph export helpers
export { getViewportSize, buildGraphSvg, applyPadding } from "./graphSvg";
export type { GraphSvgResult, GraphSvgRenderOptions } from "./graphSvg";

// Draw.io export
export { buildDrawioXml, resolveCanvasBackground } from "./drawioExport";

// Grafana export helpers
export {
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
  DEFAULT_GRAFANA_TRAFFIC_THRESHOLDS
} from "./grafanaExport";
export type { GrafanaTrafficThresholds } from "./grafanaExport";
