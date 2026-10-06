import AddIcon from "@mui/icons-material/Add";
import NorthEastIcon from "@mui/icons-material/NorthEast";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useEffect, useId, useRef } from "react";

import { emptyStateArtwork } from "./emptyStateArtwork";
import { attachEmptyStateWaves } from "./emptyStateWaves";

const OVERLAY = {
  position: "absolute",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 1,
  width: "max-content",
  maxWidth: "100%",
  boxSizing: "border-box",
  padding: "5%",
  pointerEvents: "none",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  // Lifts the copy off the dotted field without drawing a box.
  background: "radial-gradient(closest-side, var(--clab-ui-editor-background, var(--vscode-editor-background)), transparent)",
} as const;

const SECONDARY_LINK = {
  pointerEvents: "auto",
  color: "text.secondary",
  "&:hover": { color: "text.primary" },
  "& .MuiButton-endIcon > *:nth-of-type(1)": { fontSize: 14 }
} as const;

export function AttractorEmptyState({ onCreateLab }: { onCreateLab?: () => void }) {
  const patternId = useId();
  const hostRef = useRef<HTMLDivElement>(null);
  const artworkRef = useRef<SVGSVGElement>(null);
  const { size, tileSize, field, logo } = emptyStateArtwork;

  useEffect(() => {
    if (hostRef.current && artworkRef.current) {
      return attachEmptyStateWaves(hostRef.current, artworkRef.current);
    }
    return undefined;
  }, []);

  return (
    <div
      ref={hostRef}
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
      {/* The SVG paints immediately and remains the reduced-motion / graphics fallback. */}
      <Box
        component="svg"
        ref={artworkRef}
        data-testid="empty-state-artwork"
        aria-hidden="true"
        focusable="false"
        width="100%"
        height="100%"
        viewBox={`0 0 ${size} ${size}`}
        preserveAspectRatio="xMidYMid meet"
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
      <Box sx={{ ...OVERLAY, top: 104, mt: "-5%", gap: 0.75 }}>
        <Typography component="h1" sx={{ fontSize: 24, fontWeight: 500, letterSpacing: "-0.015em", lineHeight: 1.25, color: "text.primary" }}>
          Welcome to Containerlab
        </Typography>
        <Typography variant="body1" sx={{ color: "text.secondary" }}>
          Design, deploy and explore network labs.
        </Typography>
      </Box>
      <Box sx={{ ...OVERLAY, bottom: 104, mb: "-5%", flexDirection: "row", gap: 1 }}>
        {onCreateLab ? (
          <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={onCreateLab} sx={{ pointerEvents: "auto", mr: 1 }}>
            Create a lab
          </Button>
        ) : null}
        <Button variant="text" size="large" href="https://containerlab.app" target="_blank" rel="noopener noreferrer" endIcon={<NorthEastIcon />} sx={SECONDARY_LINK}>
          Docs
        </Button>
        <Button variant="text" size="large" href="https://discord.gg/vAyddtaEV9" target="_blank" rel="noopener noreferrer" endIcon={<NorthEastIcon />} sx={SECONDARY_LINK}>
          Discord
        </Button>
      </Box>
    </div>
  );
}
