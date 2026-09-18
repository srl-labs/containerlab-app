import React, { useRef } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";

const MOTION = "90ms ease-out";
const REVEALED_STYLE = {
  "--rail-item-max-width": "none",
  "--rail-label-opacity": 1,
  "--rail-label-offset": "0px",
  "--rail-surface-opacity": 1,
  zIndex: 2
};

/** Only the active row extends over the explorer; the rail itself never grows on hover. */
export function WorkspaceRailItem({ label, children, pinned, active, controls, expanded, onClick, testId }: {
  label: string;
  children: React.ReactNode;
  pinned: boolean;
  active?: boolean;
  controls?: string;
  expanded?: boolean;
  onClick: () => void;
  testId?: string;
}) {
  const itemRef = useRef<HTMLDivElement>(null);
  const suppress = () => {
    itemRef.current?.setAttribute("data-suppressed", "true");
  };

  return (
    <Box
      ref={itemRef}
      className="workspace-rail-item"
      onPointerLeave={() => itemRef.current?.removeAttribute("data-suppressed")}
      onFocusCapture={() => itemRef.current?.removeAttribute("data-suppressed")}
      sx={{
        position: "relative", width: "calc(100% - 12px)", height: 36, mx: 0.75, flexShrink: 0,
        "--rail-item-max-width": pinned ? "100%" : "36px",
        "--rail-label-opacity": pinned ? 1 : 0,
        "--rail-label-offset": pinned ? "0px" : "-4px",
        "--rail-surface-opacity": 0,
        ...(!pinned ? {
          "@media (hover: hover) and (pointer: fine)": { "&:not([data-suppressed]):hover": REVEALED_STYLE },
          "&:not([data-suppressed]):has(:focus-visible)": REVEALED_STYLE
        } : {})
      }}
    >
      <ButtonBase
        aria-label={label}
        aria-pressed={active}
        aria-controls={controls}
        aria-expanded={expanded}
        data-testid={testId}
        onClick={() => { suppress(); onClick(); }}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          suppress();
        }}
        sx={{
          position: "absolute", inset: "0 auto 0 0", width: pinned ? "100%" : "max-content", maxWidth: "var(--rail-item-max-width)", height: "100%",
          justifyContent: "flex-start", borderRadius: 1, overflow: "visible",
          color: active === true ? "primary.main" : "text.primary",
          "&.Mui-focusVisible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: -2 },
          "@media (prefers-reduced-motion: reduce)": { transition: "none", "& *": { transition: "none" } }
        }}
      >
        {/* Fixed curved shoulders meet a flexible rounded end. No SVG or text is stretched. */}
        {!pinned && (
          <Box
            aria-hidden="true"
            data-testid="rail-item-surface"
            sx={{
              position: "absolute", inset: 0, pointerEvents: "none",
              opacity: "var(--rail-surface-opacity)", transition: `opacity ${MOTION}`,
              color: "divider", "--rail-surface-fill": "var(--clab-ui-editor-background)",
              "body.vscode-high-contrast &, body.vscode-high-contrast-light &": {
                color: "var(--vscode-contrastBorder, var(--clab-ui-panel-border))"
              },
              "@media (forced-colors: active)": { color: "CanvasText", "--rail-surface-fill": "Canvas" }
            }}
          >
            <Box sx={{ position: "absolute", left: 36, top: -18, width: 18, height: "calc(100% + 36px)" }}>
              <svg width="18" height="72" viewBox="0 0 18 72" fill="none" style={{ display: "block" }}>
                <path d="M0 0H5.5Q5.5 12 18 12V60Q5.5 60 5.5 72H0Z" fill="var(--rail-surface-fill)" />
                <path d="M5.5 0Q5.5 12 18 12M18 60Q5.5 60 5.5 72" stroke="currentColor" />
              </svg>
            </Box>
            <Box sx={{
              position: "absolute", left: 54, right: -6, top: -6, bottom: -6,
              bgcolor: "var(--rail-surface-fill)", border: "1px solid currentColor", borderLeft: 0,
              borderRadius: "0 12px 12px 0"
            }} />
          </Box>
        )}
        <Box sx={{
          position: "absolute", inset: 0, borderRadius: "inherit", pointerEvents: "none",
          bgcolor: active === true ? "action.selected" : "transparent",
          ".workspace-rail-item:hover &": { bgcolor: "action.hover" }
        }} />
        <Box sx={{ position: "relative", width: 36, height: 36, flexShrink: 0, display: "grid", placeItems: "center" }}>{children}</Box>
        <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0, ml: 1, mr: 1.5, pointerEvents: "none" }}>
          <Typography
            component="span"
            variant="body2"
            noWrap
            sx={{
              flexShrink: 0, opacity: "var(--rail-label-opacity)", transform: "translateX(var(--rail-label-offset))",
              transition: `opacity ${MOTION}, transform ${MOTION}`
            }}
          >{label}</Typography>
        </Box>
      </ButtonBase>
    </Box>
  );
}
