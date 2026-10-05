/** Corner radius for floating chrome: toolbar, tabs, menus, popovers. */
export const floatingRadius = "9px";

/** Corner radius for dialogs and other modal surfaces. */
export const dialogRadius = "12px";

/** Corner radius for controls: buttons, inputs, list rows. */
export const controlRadius = "6px";

/** Height of the explorer header and the lab tab bar, border included, so their bottom edges line up. */
export const headerBarHeight = 36;

/** Layered shadows for raised surfaces. The host theme supplies the shadow color. */
export const shadowColor = "var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36))";
export const floatingShadow = `0 1px 2px ${shadowColor}, 0 6px 20px -4px ${shadowColor}`;
export const overlayShadow = `0 2px 6px ${shadowColor}, 0 24px 56px -12px ${shadowColor}`;

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
