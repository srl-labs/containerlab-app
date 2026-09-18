import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { RuntimeTerminalPaneView } from "./RuntimeTerminalWindows";

type PaneProps = React.ComponentProps<typeof RuntimeTerminalPaneView>;

export function DetachedTerminalView({ pane, message, ...props }: Pick<PaneProps, "terminalPreferences" | "onSaveTerminalPreferences"> & {
  pane?: PaneProps["paneState"];
  message: string;
}) {
  return <Box sx={{ bgcolor: "background.default", color: "text.primary", height: "100%", minHeight: 0 }}>
    {pane ? <RuntimeTerminalPaneView {...props} paneState={pane} active hidden={false} /> :
      <Box role="status" sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", p: 2 }}>
        <Typography variant="body2">{message}</Typography>
      </Box>}
  </Box>;
}
