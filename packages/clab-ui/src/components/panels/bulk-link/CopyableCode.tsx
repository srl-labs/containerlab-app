// Inline code with click-to-copy.
import React from "react";
import { Box } from "@mantine/core";

import { copyToClipboard } from "../../../utils/clipboard";

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
      style={{
        cursor: "pointer",
        userSelect: "text",
        borderRadius: 2,
        padding: "2px 4px",
        fontFamily: "monospace",
        transition: "background-color 150ms",
        ...(copied ? { outline: "1px solid" } : {})
      }}
    >
      {copied ? "Copied!" : children}
    </Box>
  );
};
