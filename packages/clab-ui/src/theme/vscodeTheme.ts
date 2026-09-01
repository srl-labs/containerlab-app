// VS Code color tokens as CSS var() references — VS Code swaps them for
// light/dark. Plain data consumed by the React Flow canvas / topology nodes.

const BUTTON_BACKGROUND = "var(--clab-ui-button-background, var(--vscode-button-background))";
const BUTTON_SECONDARY_BACKGROUND = "var(--vscode-button-secondaryBackground)";
const EDITOR_ERROR_FOREGROUND = "var(--vscode-editorError-foreground)";
const EDITOR_WARNING_FOREGROUND = "var(--vscode-editorWarning-foreground)";
const EDITOR_INFO_FOREGROUND = "var(--vscode-editorInfo-foreground)";
const TESTING_ICON_PASSED = "var(--vscode-testing-iconPassed, var(--vscode-charts-green))";
const FOCUS_BORDER = "var(--clab-ui-focus-border, var(--vscode-focusBorder))";

const buildPaletteColor = (main: string, contrastText: string) => ({
  main,
  dark: main,
  light: main,
  contrastText
});

// Single source of truth for canvas colors.
export const vscodePalette = {
  divider: "var(--clab-ui-panel-border, var(--vscode-panel-border))",
  background: {
    default: "var(--clab-ui-editor-background, var(--vscode-editor-background))",
    paper: "var(--clab-ui-panel-background, var(--vscode-sideBar-background))"
  },
  text: {
    primary: "var(--clab-ui-editor-foreground, var(--vscode-foreground))",
    secondary: "var(--vscode-descriptionForeground)",
    disabled: "var(--vscode-disabledForeground)"
  },
  primary: buildPaletteColor(BUTTON_BACKGROUND, "var(--vscode-button-foreground)"),
  secondary: buildPaletteColor(
    BUTTON_SECONDARY_BACKGROUND,
    "var(--vscode-button-secondaryForeground)"
  ),
  error: buildPaletteColor(
    EDITOR_ERROR_FOREGROUND,
    "var(--vscode-inputValidation-errorForeground)"
  ),
  warning: buildPaletteColor(
    EDITOR_WARNING_FOREGROUND,
    "var(--vscode-inputValidation-warningForeground)"
  ),
  info: buildPaletteColor(EDITOR_INFO_FOREGROUND, "var(--vscode-inputValidation-infoForeground)"),
  success: buildPaletteColor(TESTING_ICON_PASSED, "var(--vscode-button-foreground)"),
  action: {
    active: "var(--vscode-icon-foreground)",
    hover: "var(--vscode-list-hoverBackground)",
    selected: "var(--vscode-list-inactiveSelectionBackground)",
    disabled: "var(--vscode-disabledForeground)",
    disabledBackground: "var(--vscode-input-background)",
    focus: FOCUS_BORDER
  }
} as const;
