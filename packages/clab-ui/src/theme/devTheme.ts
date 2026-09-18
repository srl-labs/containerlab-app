// Dev mode --vscode-* CSS variable maps for the Vite dev view.

export interface VarMap {
  [cssVar: string]: string;
}

const CLAB_UI_VAR_ALIASES = {
  "--clab-ui-editor-background": "--vscode-editor-background",
  "--clab-ui-editor-foreground": "--vscode-editor-foreground",
  "--clab-ui-panel-background": "--vscode-sideBar-background",
  "--clab-ui-panel-border": "--vscode-panel-border",
  "--clab-ui-button-background": "--vscode-button-background",
  "--clab-ui-button-foreground": "--vscode-button-foreground",
  "--clab-ui-input-background": "--vscode-input-background",
  "--clab-ui-input-foreground": "--vscode-input-foreground",
  "--clab-ui-input-border": "--vscode-input-border",
  "--clab-ui-focus-border": "--vscode-focusBorder",
  "--clab-ui-font-family": "--vscode-font-family",
  "--clab-ui-font-size": "--vscode-font-size"
} as const;

// Dark palette — OLED black, not VS Code Dark+.
export const DARK_VARS: VarMap = {
  "--vscode-editor-background": "#000000",
  "--vscode-editor-foreground": "#ececec",
  "--vscode-sideBar-background": "#000000",
  "--vscode-sideBar-foreground": "#ececec",
  "--vscode-panel-background": "#000000",
  "--vscode-panel-border": "#222222",
  "--vscode-button-background": "#f2f2f2",
  "--vscode-button-foreground": "#000000",
  "--vscode-button-hoverBackground": "#ffffff",
  "--vscode-button-secondaryBackground": "#1a1a1a",
  "--vscode-button-secondaryForeground": "#ececec",
  "--vscode-button-secondaryHoverBackground": "#242424",
  "--vscode-input-background": "#000000",
  "--vscode-input-foreground": "#ececec",
  "--vscode-input-border": "#2a2a2a",
  "--vscode-input-placeholderForeground": "#737373",
  "--vscode-dropdown-background": "#000000",
  "--vscode-dropdown-foreground": "#ececec",
  "--vscode-dropdown-border": "#2a2a2a",
  "--vscode-focusBorder": "#ffffff",
  "--vscode-foreground": "#ececec",
  "--vscode-descriptionForeground": "#8a8a8a",
  "--vscode-errorForeground": "#ff6b6b",
  "--vscode-icon-foreground": "#c8c8c8",
  "--vscode-list-hoverBackground": "#161616",
  "--vscode-list-activeSelectionBackground": "#2a2a2a",
  "--vscode-list-activeSelectionForeground": "#ffffff",
  "--vscode-list-inactiveSelectionBackground": "#1a1a1a",
  "--vscode-list-inactiveSelectionForeground": "#ececec",
  "--vscode-badge-background": "#2a2a2a",
  "--vscode-badge-foreground": "#ffffff",
  "--vscode-scrollbarSlider-background": "rgba(255, 255, 255, 0.16)",
  "--vscode-scrollbarSlider-hoverBackground": "rgba(255, 255, 255, 0.28)",
  "--vscode-scrollbarSlider-activeBackground": "rgba(255, 255, 255, 0.4)",
  "--vscode-statusBar-background": "#000000",
  "--vscode-statusBar-foreground": "#ececec",
  "--vscode-tab-activeBackground": "#000000",
  "--vscode-tab-activeForeground": "#ffffff",
  "--vscode-tab-inactiveBackground": "#000000",
  "--vscode-tab-inactiveForeground": "#8a8a8a",
  "--vscode-tab-activeBorderTop": "#ffffff",
  "--vscode-tab-hoverBackground": "#161616",
  "--vscode-textLink-foreground": "#ffffff",
  "--vscode-textLink-activeForeground": "#ffffff",
  "--vscode-textCodeBlock-background": "#000000",
  "--vscode-settings-textInputBackground": "#000000",
  "--vscode-settings-textInputForeground": "#ececec",
  "--vscode-settings-textInputBorder": "#2a2a2a",
  "--vscode-notifications-background": "#000000",
  "--vscode-notifications-foreground": "#ececec",
  "--vscode-notifications-border": "#222222",
  "--vscode-disabledForeground": "#555555",
  "--vscode-checkbox-border": "#8a8a8a",
  "--vscode-editorWidget-background": "#000000",
  "--vscode-editorWidget-foreground": "#ececec",
  "--vscode-editorWidget-border": "#222222",
  "--vscode-widget-shadow": "rgba(0, 0, 0, 0.7)",
  "--vscode-menu-background": "#000000",
  "--vscode-menu-foreground": "#ececec",
  "--vscode-menu-border": "#222222",
  "--vscode-menu-selectionBackground": "#2a2a2a",
  "--vscode-menu-selectionForeground": "#ffffff",
  "--vscode-inputValidation-errorBackground": "#2a0a0a",
  "--vscode-inputValidation-errorBorder": "#ff6b6b",
  "--vscode-inputValidation-errorForeground": "#ffffff",
  "--vscode-inputValidation-warningBackground": "#2a2208",
  "--vscode-inputValidation-warningBorder": "#e6b422",
  "--vscode-inputValidation-warningForeground": "#ffffff",
  "--vscode-inputValidation-infoBackground": "#000000",
  "--vscode-inputValidation-infoBorder": "#8a8a8a",
  "--vscode-inputValidation-infoForeground": "#ffffff",
  "--vscode-editorError-foreground": "#ff6b6b",
  "--vscode-editorWarning-foreground": "#e6b422",
  "--vscode-editorInfo-foreground": "#a8a8a8",
  "--vscode-charts-yellow": "#e6b422",
  "--vscode-testing-iconPassed": "#3dd68c",
  "--vscode-charts-green": "#3dd68c",
  "--vscode-progressBar-background": "#ffffff",
  "--vscode-font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  "--vscode-font-size": "13px"
};

// Light palette
export const LIGHT_VARS: VarMap = {
  "--vscode-editor-background": "#ffffff",
  "--vscode-editor-foreground": "#333333",
  "--vscode-sideBar-background": "#f3f3f3",
  "--vscode-sideBar-foreground": "#333333",
  "--vscode-panel-background": "#ffffff",
  "--vscode-panel-border": "#e7e7e7",
  "--vscode-button-background": "#007acc",
  "--vscode-button-foreground": "#ffffff",
  "--vscode-button-hoverBackground": "#0062a3",
  "--vscode-button-secondaryBackground": "#5f6a79",
  "--vscode-button-secondaryForeground": "#ffffff",
  "--vscode-button-secondaryHoverBackground": "#4c5561",
  "--vscode-input-background": "#ffffff",
  "--vscode-input-foreground": "#333333",
  "--vscode-input-border": "#cecece",
  "--vscode-input-placeholderForeground": "#767676",
  "--vscode-dropdown-background": "#ffffff",
  "--vscode-dropdown-foreground": "#333333",
  "--vscode-dropdown-border": "#cecece",
  "--vscode-focusBorder": "#0090f1",
  "--vscode-foreground": "#333333",
  "--vscode-descriptionForeground": "#717171",
  "--vscode-errorForeground": "#a1260d",
  "--vscode-icon-foreground": "#424242",
  "--vscode-list-hoverBackground": "#e8e8e8",
  "--vscode-list-activeSelectionBackground": "#0060c0",
  "--vscode-list-activeSelectionForeground": "#ffffff",
  "--vscode-list-inactiveSelectionBackground": "#e5ebf1",
  "--vscode-list-inactiveSelectionForeground": "#333333",
  "--vscode-badge-background": "#c4c4c4",
  "--vscode-badge-foreground": "#333333",
  "--vscode-scrollbarSlider-background": "rgba(100, 100, 100, 0.4)",
  "--vscode-scrollbarSlider-hoverBackground": "rgba(100, 100, 100, 0.7)",
  "--vscode-scrollbarSlider-activeBackground": "rgba(0, 0, 0, 0.6)",
  "--vscode-statusBar-background": "#007acc",
  "--vscode-statusBar-foreground": "#ffffff",
  "--vscode-tab-activeBackground": "#ffffff",
  "--vscode-tab-activeForeground": "#333333",
  "--vscode-tab-inactiveBackground": "#ececec",
  "--vscode-tab-inactiveForeground": "#33333380",
  "--vscode-tab-activeBorderTop": "#0090f1",
  "--vscode-tab-hoverBackground": "#e8e8e8",
  "--vscode-textLink-foreground": "#006ab1",
  "--vscode-textLink-activeForeground": "#006ab1",
  "--vscode-textCodeBlock-background": "#f3f3f3",
  "--vscode-settings-textInputBackground": "#ffffff",
  "--vscode-settings-textInputForeground": "#333333",
  "--vscode-settings-textInputBorder": "#cecece",
  "--vscode-notifications-background": "#f3f3f3",
  "--vscode-notifications-foreground": "#333333",
  "--vscode-notifications-border": "#e7e7e7",
  "--vscode-disabledForeground": "#999999",
  "--vscode-checkbox-border": "#424242",
  "--vscode-editorWidget-background": "#f3f3f3",
  "--vscode-editorWidget-foreground": "#333333",
  "--vscode-editorWidget-border": "#cecece",
  "--vscode-widget-shadow": "rgba(0, 0, 0, 0.16)",
  "--vscode-menu-background": "#ffffff",
  "--vscode-menu-foreground": "#333333",
  "--vscode-menu-border": "#cecece",
  "--vscode-menu-selectionBackground": "#0060c0",
  "--vscode-menu-selectionForeground": "#ffffff",
  "--vscode-inputValidation-errorBackground": "#fce4e4",
  "--vscode-inputValidation-errorBorder": "#be1100",
  "--vscode-inputValidation-errorForeground": "#333333",
  "--vscode-inputValidation-warningBackground": "#fefce4",
  "--vscode-inputValidation-warningBorder": "#9d8600",
  "--vscode-inputValidation-warningForeground": "#333333",
  "--vscode-inputValidation-infoBackground": "#e6f3fb",
  "--vscode-inputValidation-infoBorder": "#007acc",
  "--vscode-inputValidation-infoForeground": "#333333",
  "--vscode-editorError-foreground": "#a1260d",
  "--vscode-editorWarning-foreground": "#bf8803",
  "--vscode-editorInfo-foreground": "#1a85ff",
  "--vscode-charts-yellow": "#bf8803",
  "--vscode-testing-iconPassed": "#388a34",
  "--vscode-charts-green": "#16825d",
  "--vscode-progressBar-background": "#007acc",
  "--vscode-font-family": "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  "--vscode-font-size": "13px"
};

// Apply CSS variable map as inline styles on <html> for dev mode.
function applyAliasVars(root: HTMLElement, vars: VarMap): void {
  for (const [alias, source] of Object.entries(CLAB_UI_VAR_ALIASES)) {
    const value = vars[source];
    if (typeof value === "string" && value.length > 0) {
      root.style.setProperty(alias, value);
    }
  }
}

export function applyThemeVars(mode: "light" | "dark"): void {
  const vars = mode === "light" ? LIGHT_VARS : DARK_VARS;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
  applyAliasVars(root, vars);
  root.style.colorScheme = mode;
}

export function applyDevVars(mode: "light" | "dark"): void {
  applyThemeVars(mode);
}
