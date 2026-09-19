import "../types/assets";
// MUI ThemeProvider wrapper — static theme with CSS var() palette.
import React from "react";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import "@fontsource/roboto/300.css";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";

import { useAppearance } from "./useAppearance";

export const MuiThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const theme = useAppearance();
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      {children}
    </ThemeProvider>
  );
};
