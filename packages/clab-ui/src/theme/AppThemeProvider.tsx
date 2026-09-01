// Mantine-only theme provider, tinted to the host VS Code color scheme.
import React from "react";
import {
  MantineProvider,
  createTheme,
  type CSSVariablesResolver,
  type MantineColorsTuple
} from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "./appTheme.css";

const VSCODE_BUTTON = "var(--clab-ui-button-background, var(--vscode-button-background))";
// Mantine requires a 10-shade tuple; every shade points at the VS Code button
// background so the primary color follows the active editor theme at runtime.
const vscodePrimary = Array.from({ length: 10 }, () => VSCODE_BUTTON) as unknown as MantineColorsTuple;

const theme = createTheme({
  fontFamily: "'Roboto', sans-serif",
  fontFamilyMonospace: "var(--vscode-editor-font-family, 'Roboto Mono', monospace)",
  primaryColor: "vscode",
  defaultRadius: "sm",
  colors: { vscode: vscodePrimary }
});

// Map Mantine's surface/text/border tokens onto VS Code theme variables.
const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    "--mantine-primary-color-contrast": "var(--vscode-button-foreground)"
  },
  light: {},
  dark: {
    "--mantine-color-body": "var(--clab-ui-editor-background, var(--vscode-editor-background))",
    "--mantine-color-text": "var(--clab-ui-editor-foreground, var(--vscode-foreground))",
    "--mantine-color-dimmed": "var(--vscode-descriptionForeground)",
    "--mantine-color-default": "var(--vscode-input-background)",
    "--mantine-color-default-hover": "var(--vscode-list-hoverBackground)",
    "--mantine-color-default-color": "var(--vscode-input-foreground)",
    "--mantine-color-default-border": "var(--clab-ui-panel-border, var(--vscode-panel-border))",
    "--mantine-color-anchor": "var(--vscode-textLink-foreground)"
  }
});

export const AppThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MantineProvider
    theme={theme}
    defaultColorScheme="dark"
    cssVariablesResolver={cssVariablesResolver}
  >
    {children}
  </MantineProvider>
);
