/** Portable viewer contracts shared by the editor package and standalone distribution. */
export interface ViewerOptions {
  controls?: boolean;
  background?: "dots" | "lines" | "none";
  transparent?: boolean;
  nodeLabels?: boolean;
  linkLabels?: "show-all" | "on-select" | "hide";
  zoomOnScroll?: boolean;
  panOnDrag?: boolean;
  fitPadding?: number;
  /** Colors/fonts supplied by the embedding page, also applied inside the iframe. */
  appearance?: Partial<Record<"background" | "foreground" | "surface" | "border" | "accent" | "edge" | "font", string>>;
  onNodeSelect?: (id: string | null) => void;
}

export interface ViewerNodeInfo {
  id: string;
  kind: string;
  image: string;
  startLine: number;
  endLine: number;
}

export interface MountViewerOptions {
  /** Raw containerlab YAML. */
  yaml: string;
  /** Raw annotations JSON, including saved positions and visual annotations. */
  annotations?: string;
  theme?: "light" | "dark";
  borderless?: boolean;
  viewerOptions?: ViewerOptions;
  /** Fires once the graph is measured, fitted, and painted. */
  onReady?: (description: { nodes: ViewerNodeInfo[]; links: number }) => void;
  onError?: (error: unknown) => void;
}

export interface ViewerHandle {
  /** Dispose the viewer before removing its container or mounting another topology. */
  unmount(): void;
}
