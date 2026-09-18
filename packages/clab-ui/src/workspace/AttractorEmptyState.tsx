import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import AddIcon from "@mui/icons-material/Add";
import { useId } from "react";

import { emptyStateArtwork } from "./emptyStateArtwork";

export function AttractorEmptyState({ onCreateLab }: { onCreateLab?: () => void }) {
  const patternId = useId();
  const { size, tileSize, field, logo } = emptyStateArtwork;

  return (
    <div
      data-testid="standalone-empty-lab-state"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        overflow: "hidden",
        pointerEvents: "auto",
        backgroundColor: "var(--vscode-editor-background, #000000)",
      }}
    >
      {/* Baked paths paint with the workspace. No image decode, worker, or render loop. */}
      <Box
        component="svg"
        data-testid="empty-state-artwork"
        aria-hidden="true"
        focusable="false"
        width="100%"
        height="100%"
        viewBox={`0 0 ${size} ${size}`}
        fill="currentColor"
        sx={{
          position: "absolute", inset: 0, pointerEvents: "none", color: "#fff",
          "--empty-state-light": 0,
          "html.light &, body.vscode-light &, body.vscode-high-contrast-light &": {
            color: "#000", "--empty-state-light": 1
          }
        }}
      >
        <defs>
          <pattern id={patternId} width={tileSize} height={tileSize} patternUnits="userSpaceOnUse">
            {field.map(({ path, dark, light: lightOpacity }, index) => (
              <path key={index} d={path} style={{ opacity: `calc(${dark} + var(--empty-state-light) * ${lightOpacity - dark})` }} />
            ))}
          </pattern>
        </defs>
        {/* Cover the viewport beyond the square viewBox in wide and tall windows. */}
        <rect x="-10000" y="-10000" width="20000" height="20000" fill={`url(#${patternId})`} />
        {logo.map(({ path, dark, light: lightOpacity }, index) => (
          <path key={index} d={path} style={{ opacity: `calc(${dark} + var(--empty-state-light) * ${lightOpacity - dark})` }} />
        ))}
      </Box>
      {onCreateLab && <Button variant="text" startIcon={<AddIcon />} onClick={onCreateLab} sx={{ position: "absolute", top: 72, left: "50%", transform: "translateX(-50%)", zIndex: 1, whiteSpace: "nowrap", color: "text.secondary", fontSize: "1.25rem", textTransform: "none", "&:hover": { color: "text.primary" } }}>Create a lab</Button>}
    </div>
  );
}
