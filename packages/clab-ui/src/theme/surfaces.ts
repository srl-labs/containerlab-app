/** Corner radius for floating chrome: toolbar, tabs, menus, dialogs. */
export const floatingRadius = "9px";

/** Shared floating chrome. Host themes provide colors; components own geometry. */
export const floatingSurfaceSx = {
  bgcolor: "var(--clab-ui-editor-background, var(--vscode-editor-background, #000))",
  backgroundImage: "none",
  border: 1,
  borderColor: "divider",
  boxShadow: "none",
  "body.vscode-high-contrast &, body.vscode-high-contrast-light &": {
    bgcolor: "background.default",
    borderColor: "var(--vscode-contrastBorder, var(--clab-ui-panel-border))"
  },
  "@media (forced-colors: active)": {
    bgcolor: "Canvas",
    borderColor: "CanvasText"
  }
} as const;
