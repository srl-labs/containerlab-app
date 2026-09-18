/** Shared floating chrome. Host themes provide colors; components own geometry. */
export const floatingSurfaceSx = {
  bgcolor: "color-mix(in srgb, var(--clab-ui-editor-background) 78%, transparent)",
  backdropFilter: "blur(24px) saturate(1.6)",
  WebkitBackdropFilter: "blur(24px) saturate(1.6)",
  border: 1,
  borderColor: "divider",
  boxShadow: "none",
  "body.vscode-high-contrast &, body.vscode-high-contrast-light &": {
    bgcolor: "background.default",
    backdropFilter: "none",
    WebkitBackdropFilter: "none",
    borderColor: "var(--vscode-contrastBorder, var(--clab-ui-panel-border))"
  },
  "@media (forced-colors: active)": {
    bgcolor: "Canvas",
    borderColor: "CanvasText",
    backdropFilter: "none"
  }
} as const;
