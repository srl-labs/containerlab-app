// Inline code with click-to-copy.
import React from "react";
import Box from "@mui/material/Box";

import { copyToClipboard } from "../../../utils/clipboard";
import { MONO_FONT_FAMILY } from "../../../theme/typography";

interface CopyableCodeProps {
  children: string;
}

export const CopyableCode: React.FC<CopyableCodeProps> = ({ children }) => {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    const success = await copyToClipboard(children);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }, [children]);

  return (
    <Box
      component="code"
      onClick={() => void handleCopy()}
      title="Click to copy"
      sx={{
        cursor: "pointer",
        userSelect: "text",
        borderRadius: 1,
        px: 0.5,
        py: 0.25,
        fontFamily: MONO_FONT_FAMILY,
        fontSize: 12,
        color: "text.primary",
        bgcolor: "action.hover",
        transition: "background-color 120ms ease",
        "&:hover": { bgcolor: "action.selected" },
        ...(copied ? { outline: "1px solid var(--vscode-focusBorder)" } : {})
      }}
    >
      {copied ? "Copied!" : children}
    </Box>
  );
};
