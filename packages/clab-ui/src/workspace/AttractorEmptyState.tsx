import Box from "@mui/material/Box";
import { useEffect, useId, useRef } from "react";

import { emptyStateArtwork } from "./emptyStateArtwork";
import { attachEmptyStateWaves } from "./emptyStateWaves";

const OVERLAY_TEXT = {
  position: "absolute",
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 1,
  width: "max-content",
  padding: "5%",
  pointerEvents: "none",
  color: "var(--vscode-editor-foreground, #ececec)",
  fontSize: 24,
  fontWeight: 300,
  letterSpacing: "0.02em",
  background: "radial-gradient(closest-side, var(--vscode-editor-background, #000), transparent)",
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
      <div style={{ ...OVERLAY_TEXT, top: 104, marginTop: "-5%" }}>
        Welcome to Containerlab
      </div>
      <style>{`
        [data-testid="standalone-empty-lab-state"] .empty-state-link {
          color: inherit;
          background: none;
          border: 0;
          padding: 0;
          font: inherit;
          cursor: pointer;
          text-decoration: none;
          opacity: 0.72;
          transition: opacity 160ms ease;
        }
        [data-testid="standalone-empty-lab-state"] .empty-state-link:hover,
        [data-testid="standalone-empty-lab-state"] .empty-state-link:focus-visible {
          opacity: 1;
        }
      `}</style>
      <div style={{ ...OVERLAY_TEXT, bottom: 104, marginBottom: "-5%", display: "flex", gap: "2em" }}>
        {onCreateLab ? (
          <button type="button" className="empty-state-link" style={{ pointerEvents: "auto" }} onClick={onCreateLab}>
            Create a lab
          </button>
        ) : null}
        <a className="empty-state-link" href="https://containerlab.app" target="_blank" rel="noopener noreferrer" style={{ pointerEvents: "auto" }}>
          Docs
        </a>
        <a className="empty-state-link" href="https://discord.gg/vAyddtaEV9" target="_blank" rel="noopener noreferrer" style={{ pointerEvents: "auto" }}>
          Discord
        </a>
      </div>
    </div>
  );
}
