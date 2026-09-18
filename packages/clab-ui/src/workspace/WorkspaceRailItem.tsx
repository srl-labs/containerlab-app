import React, { createContext, useContext, useRef } from "react";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";

const MOTION = "160ms cubic-bezier(0.4, 0, 0.2, 1)";
const REVEALED_STYLE = {
  "--rail-item-max-width": "240px",
  "--rail-label-opacity": 1,
  "--rail-label-offset": "0px",
  "--rail-surface-opacity": 1,
  zIndex: 2
};

export const RailPinnedContext = createContext(false);
export function useRailPinned(): boolean {
  return useContext(RailPinnedContext);
}

/** Only the hovered row extends a carved label; the rail itself never grows on hover. */
export const WorkspaceRailItem = React.forwardRef<HTMLButtonElement, {
  label: string;
  children: React.ReactNode;
  pinned: boolean;
  active?: boolean;
  controls?: string;
  expanded?: boolean;
  onClick: () => void;
  testId?: string;
  trailing?: React.ReactNode;
  role?: React.AriaRole;
  tabIndex?: number;
  onKeyDown?: (event: React.KeyboardEvent) => void;
}>(function WorkspaceRailItem({
  label, children, pinned, active, controls, expanded, onClick, testId, trailing, role, tabIndex, onKeyDown
}, ref) {
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
        ref={ref}
        role={role}
        tabIndex={tabIndex}
        aria-label={label}
        aria-pressed={role === "tab" ? undefined : active}
        aria-selected={role === "tab" ? active : undefined}
        aria-controls={controls}
        aria-expanded={expanded}
        data-testid={testId}
        component={role === "tab" ? "div" : "button"}
        onClick={() => { suppress(); onClick(); }}
        onKeyDown={(event: React.KeyboardEvent) => {
          onKeyDown?.(event);
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          suppress();
        }}
        sx={{
          position: "absolute", inset: "0 auto 0 0", width: pinned ? "100%" : "max-content", maxWidth: "var(--rail-item-max-width)", height: "100%",
          justifyContent: "flex-start", borderRadius: 1, overflow: "visible",
          color: active === true ? "primary.main" : "text.primary",
          transition: `max-width ${MOTION}`,
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
            <Box sx={{ position: "absolute", left: 36, top: -18, width: 18, height: "calc(100% + 36px)", overflow: "visible" }}>
              <svg width="18" height="72" viewBox="0 0 18 72" fill="none" overflow="visible" style={{ display: "block", overflow: "visible" }}>
                <path d="M0 0H4.5Q4.5 12 18 12V60Q4.5 60 4.5 72H0Z" fill="var(--rail-surface-fill)" />
                <path d="M4.5 0Q4.5 12 18 12H20M20 60H18Q4.5 60 4.5 72" stroke="currentColor" />
              </svg>
            </Box>
            <Box sx={{
              position: "absolute", left: 54, right: -6, top: "-6.5px", bottom: "-6.5px",
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
        <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0, ml: 1, mr: trailing ? 0.5 : 1.5, pointerEvents: "none" }}>
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
        {trailing ? (
          <Box
            sx={{
              display: "flex", alignItems: "center", flexShrink: 0, mr: 0.75,
              opacity: "var(--rail-label-opacity)", transition: `opacity ${MOTION}`,
              pointerEvents: pinned ? "auto" : "none",
              ".workspace-rail-item:hover &, .workspace-rail-item:has(:focus-visible) &": { pointerEvents: "auto" }
            }}
          >
            {trailing}
          </Box>
        ) : null}
      </ButtonBase>
    </Box>
  );
});
WorkspaceRailItem.displayName = "WorkspaceRailItem";
