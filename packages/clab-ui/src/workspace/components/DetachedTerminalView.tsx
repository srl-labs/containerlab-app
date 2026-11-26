import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { RuntimeTerminalPaneView } from "./RuntimeTerminalWindows";

type PaneProps = React.ComponentProps<typeof RuntimeTerminalPaneView>;

export function DetachedTerminalView({ pane, message, ...props }: Pick<PaneProps, "terminalPreferences" | "onSaveTerminalPreferences"> & {
  pane?: PaneProps["paneState"];
  message: string;
}) {
  // The pane sizes itself with `flex: 1`, as in the docked terminal panel, so this box must be a
  // flex column. Otherwise the pane keeps the height of the 24 rows xterm.js starts with.
  return <Box sx={{ bgcolor: "background.default", color: "text.primary", display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
    {pane ? <RuntimeTerminalPaneView {...props} paneState={pane} active hidden={false} /> :
      <Box role="status" sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", p: 2 }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>{message}</Typography>
      </Box>}
  </Box>;
}
