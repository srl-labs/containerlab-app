/**
 * SVG export style constants matching canvas rendering
 * These values are extracted from the React Flow node/edge components
 */

/** Root graph layer class used to distinguish topology content from annotation layers. */
export const GRAPH_LAYER_CLASS = "export-graph-layer";

// ============================================================================
// Node Constants
// ============================================================================

/** Node icon size (matches TopologyNode.tsx ICON_SIZE) */
export const NODE_ICON_SIZE = 40;

/** Node icon corner radius */
export const NODE_ICON_RADIUS = 4;

/** Default icon color (matches graph.ts DEFAULT_ICON_COLOR). Host apps may
 *  override it via window.__CLAB_UI_DEFAULT_ICON_COLOR__ set before load. */
const iconColorOverride =
  typeof window !== "undefined"
    ? (window as Window & { __CLAB_UI_DEFAULT_ICON_COLOR__?: string })
        .__CLAB_UI_DEFAULT_ICON_COLOR__
    : undefined;
export const DEFAULT_ICON_COLOR = iconColorOverride || "#005aff";

// ============================================================================
// Node Label Constants (matches nodeStyles.ts LABEL_STYLE_BASE)
// ============================================================================

export const NODE_LABEL = {
  fontWeight: 500,
  color: "#F5F5F5",
  textShadowColor: "#3C3E41",
  textShadowBlur: 3,
  backgroundColor: "rgba(0, 0, 0, 0.7)",
  paddingX: 4,
  paddingY: 1,
  borderRadius: 3,
  maxWidth: 110,
  fontSize: 11.2, // 0.7rem
  lineHeight: 1.4,
  /** Gap between icon and label */
  marginTop: 2
} as const;

// ============================================================================
// Edge Constants (matches TopologyEdge.tsx)
// ============================================================================

export const EDGE_COLOR = {
  default: "#969799",
  up: "#00df2b",
  down: "#df2b00"
} as const;

export const EDGE_STYLE = {
  /** Matches TopologyEdge.tsx EDGE_WIDTH_NORMAL */
  strokeWidth: 4,
  opacity: 0.5
} as const;

/** Control point step size for parallel edge bezier curves */
export const CONTROL_POINT_STEP_SIZE = 40;

// ============================================================================
// Edge Label Constants (matches TopologyEdge.tsx label variants)
// ============================================================================

/** Default-style endpoint pill (matches TopologyEdge.tsx LABEL_STYLE_BASE). The
 *  canvas colors come from theme CSS variables; resolveCssColor() resolves
 *  them against the live document at export time (these are the fallbacks). */
export const EDGE_LABEL = {
  fontSize: 10,
  fontFamily: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  color: "#d4d4d4",
  backgroundColor: "#1e1e1e",
  lineHeight: 1.2,
  paddingX: 2,
  borderRadius: 4
} as const;

/** Telemetry-style endpoint bubble (matches TopologyEdge.tsx TELEMETRY_LABEL_*). */
export const TELEMETRY_EDGE_LABEL = {
  fontSize: 10,
  fontWeight: 600,
  fontFamily: "Helvetica, Arial, sans-serif",
  color: "#FFFFFF",
  backgroundColor: "#bec8d2",
  textStrokeColor: "rgba(0, 0, 0, 0.95)",
  textStrokeWidth: 0.6,
  outlineColor: "rgba(0, 0, 0, 0.25)",
  bubbleStrokeWidth: 0.7,
  minRadius: 7,
  charWidthRatio: 0.58,
  paddingX: 2,
  /** Gap between bubble edge and node border (matches TELEMETRY_LABEL_OFFSET_PADDING_PX) */
  offsetPadding: 1,
  /** Loop edge label offset (matches TELEMETRY_LOOP_LABEL_OFFSET) */
  loopOffset: 10
} as const;

// ============================================================================
// Network Node Type Colors (matches NetworkNode.tsx getNodeTypeColor)
// ============================================================================

const NETWORK_TYPE_COLOR: Record<string, string> = {
  host: "#6B7280",
  "mgmt-net": "#3B82F6",
  macvlan: "#10B981",
  vxlan: "#8B5CF6",
  bridge: "#F59E0B",
  "ovs-bridge": "#F59E0B",
  default: "#6B7280"
} as const;

/** Get network node icon color by type */
export function getNetworkTypeColor(nodeType: string): string {
  return NETWORK_TYPE_COLOR[nodeType] ?? NETWORK_TYPE_COLOR.default;
}

// ============================================================================
// Role to SVG Type Mapping (matches graph.ts ROLE_SVG_MAP)
// ============================================================================

/** Map node role names to icon types */
const ROLE_SVG_MAP: Record<string, string> = {
  router: "pe",
  "Provider Edge Router": "pe",
  "provider edge router": "pe",
  dcgw: "dcgw",
  "dcgw-evpn": "dcgw",
  leaf: "leaf",
  switch: "switch",
  bridge: "bridge",
  spine: "spine",
  "super-spine": "super-spine",
  server: "server",
  pon: "pon",
  controller: "controller",
  rgw: "rgw",
  ue: "ue",
  cloud: "cloud",
  client: "client"
} as const;

/** Get SVG node type from role string */
export function getRoleSvgType(role: string): string {
  return ROLE_SVG_MAP[role] ?? "pe";
}

// ============================================================================
// SVG Filter Definitions
// ============================================================================

/**
 * SVG filter for text shadow effect (matches nodeStyles.ts textShadow)
 */
const TEXT_SHADOW_FILTER = `
<filter id="text-shadow" x="-50%" y="-50%" width="200%" height="200%">
  <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="blur"/>
  <feFlood flood-color="${NODE_LABEL.textShadowColor}" result="color"/>
  <feComposite in="color" in2="blur" operator="in" result="shadow"/>
  <feMerge>
    <feMergeNode in="shadow"/>
    <feMergeNode in="SourceGraphic"/>
  </feMerge>
</filter>
`;

/**
 * Generate SVG defs section with all needed filters
 */
export function buildSvgDefs(): string {
  return `<defs>${TEXT_SHADOW_FILTER}</defs>`;
}

// ============================================================================
// Theme Color Resolution
// ============================================================================

/**
 * Resolve a CSS color expression (e.g. a `var()` chain) against the live
 * document so exported colors match the current theme. Returns the fallback
 * when no DOM is available (tests) or resolution fails.
 */
export function resolveCssColor(cssValue: string, fallback: string): string {
  if (typeof document === "undefined" || document.body === null) return fallback;
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = fallback;
  probe.style.color = cssValue;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved.length > 0 ? resolved : fallback;
}

// ============================================================================
// XML Utilities
// ============================================================================

/**
 * Escape special XML characters for safe embedding in SVG
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
