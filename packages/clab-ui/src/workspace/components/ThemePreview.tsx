import React from "react";
import Box from "@mui/material/Box";

import { TERMINAL_ANSI_TOKENS, type VarMap } from "../../theme/devTheme";
import { floatingRadius } from "../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../theme/typography";

// Every painted part carries `data-theme-role`: the color role that paints it, so a
// click can open that role in the editor.

const v = (token: string) => `var(--vscode-${token})`;

const ROW_BACKGROUNDS = {
  selected: v("list-inactiveSelectionBackground"),
  hover: v("list-hoverBackground")
} as const;

const EXPLORER_ROWS = [
  { label: "fabric.clab.yml", state: "selected", role: "selection", dot: null },
  { label: "spine1", state: null, role: "surface", dot: { token: "testing-iconPassed", role: "success" } },
  { label: "leaf1", state: "hover", role: "hover", dot: { token: "testing-iconPassed", role: "success" } },
  { label: "leaf2", state: null, role: "surface", dot: { token: "editorError-foreground", role: "error" } },
  { label: "client1", state: null, role: "surface", dot: { token: "descriptionForeground", role: "muted" } }
] as const;

const NODES = [
  { name: "spine1", x: 50, y: 27, selected: true },
  { name: "leaf1", x: 27, y: 66, selected: false },
  { name: "leaf2", x: 73, y: 66, selected: false }
] as const;

const STATUS_LINES = [
  { label: "Running", token: "testing-iconPassed", role: "success" },
  { label: "1 warning", token: "editorWarning-foreground", role: "warning" },
  { label: "Failed", token: "editorError-foreground", role: "error" },
  { label: "Starting", token: "editorInfo-foreground", role: "info" }
] as const;

function Dot({ token, role }: { token: string; role: string }) {
  return (
    <Box
      component="span"
      data-theme-role={role}
      sx={{ width: 7, height: 7, flexShrink: 0, borderRadius: "50%", bgcolor: v(token) }}
    />
  );
}

function Rail() {
  return (
    <Box
      data-theme-role="surface"
      sx={{
        width: 32,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1.25,
        pt: 1.25,
        bgcolor: v("sideBar-background"),
        borderRight: `1px solid ${v("panel-border")}`
      }}
    >
      {[0, 1, 2, 3].map((index) => (
        <Box
          key={index}
          data-theme-role={index === 0 ? "accent" : "foreground"}
          sx={{
            width: 14,
            height: 14,
            borderRadius: "3px",
            bgcolor: index === 0 ? v("button-background") : v("icon-foreground"),
            opacity: index === 0 ? 1 : 0.5
          }}
        />
      ))}
    </Box>
  );
}

function Explorer() {
  return (
    <Box
      data-theme-role="surface"
      sx={{
        width: "24%",
        flexShrink: 0,
        py: 1,
        bgcolor: v("sideBar-background"),
        color: v("sideBar-foreground"),
        borderRight: `1px solid ${v("panel-border")}`,
        overflow: "hidden"
      }}
    >
      <Box
        data-theme-role="muted"
        sx={{ px: 1.25, pb: 0.75, fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: v("descriptionForeground") }}
      >
        LABS
      </Box>
      {EXPLORER_ROWS.map((row, index) => (
        <Box
          key={row.label}
          data-theme-role={row.role}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            pl: index === 0 ? 1.25 : 2.5,
            pr: 1,
            py: 0.375,
            whiteSpace: "nowrap",
            bgcolor: row.state === null ? "transparent" : ROW_BACKGROUNDS[row.state],
            color: row.state === "selected" ? v("list-inactiveSelectionForeground") : "inherit"
          }}
        >
          {row.dot === null ? null : <Dot token={row.dot.token} role={row.dot.role} />}
          <Box component="span" data-theme-role="foreground" sx={{ overflow: "hidden", textOverflow: "ellipsis" }}>
            {row.label}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function Canvas() {
  return (
    <Box
      data-theme-role="background"
      sx={{
        position: "relative",
        flex: 1,
        minHeight: 0,
        backgroundImage: `radial-gradient(${v("panel-border")} 1px, transparent 1.2px)`,
        backgroundSize: "14px 14px"
      }}
    >
      <Box
        data-theme-role="border"
        sx={{
          position: "absolute",
          top: 8,
          left: 10,
          display: "flex",
          gap: 0.75,
          px: 1,
          py: 0.625,
          borderRadius: "7px",
          bgcolor: v("editor-background"),
          border: `1px solid ${v("panel-border")}`
        }}
      >
        {[0, 1, 2, 3].map((index) => (
          <Box
            key={index}
            data-theme-role="foreground"
            sx={{ width: 11, height: 11, borderRadius: "2px", bgcolor: v("icon-foreground"), opacity: 0.6 }}
          />
        ))}
      </Box>
      <Box
        component="svg"
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
      >
        {NODES.slice(1).map((node) => (
          <line
            key={node.name}
            x1={NODES[0].x}
            y1={NODES[0].y}
            x2={node.x}
            y2={node.y}
            stroke={v("descriptionForeground")}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </Box>
      {NODES.map((node) => (
        <Box
          key={node.name}
          sx={{
            position: "absolute",
            left: `${node.x}%`,
            top: `${node.y}%`,
            transform: "translate(-50%, -50%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 0.625
          }}
        >
          <Box
            data-theme-role={node.selected ? "accent" : "raised"}
            sx={{
              width: 32,
              height: 32,
              display: "grid",
              placeItems: "center",
              borderRadius: "7px",
              bgcolor: v("button-secondaryBackground"),
              border: `1px solid ${v("panel-border")}`,
              outline: node.selected ? `2px solid ${v("focusBorder")}` : "none",
              outlineOffset: 2
            }}
          >
            <Box
              data-theme-role="foreground"
              sx={{ width: 13, height: 13, borderRadius: "2px", border: `2px solid ${v("icon-foreground")}` }}
            />
          </Box>
          <Box
            data-theme-role="badge"
            sx={{
              px: 0.625,
              borderRadius: "3px",
              fontSize: 10,
              lineHeight: 1.6,
              bgcolor: v("badge-background"),
              color: v("foreground")
            }}
          >
            {node.name}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function Terminal() {
  return (
    <Box
      data-theme-role="background"
      sx={{
        height: "32%",
        flexShrink: 0,
        px: 1.25,
        py: 0.75,
        display: "flex",
        flexDirection: "column",
        gap: 0.5,
        borderTop: `1px solid ${v("panel-border")}`,
        fontFamily: MONO_FONT_FAMILY,
        fontSize: 11,
        whiteSpace: "nowrap",
        overflow: "hidden"
      }}
    >
      <Box>
        <Box component="span" data-theme-role="ansi.green" sx={{ color: v("terminal-ansiGreen") }}>
          admin@srl1
        </Box>
        <Box component="span" data-theme-role="ansi.blue" sx={{ color: v("terminal-ansiBlue") }}>
          :~$
        </Box>{" "}
        <Box component="span" data-theme-role="foreground">show version</Box>
      </Box>
      <Box>
        <Box component="span" data-theme-role="foreground">Hostname</Box>{" "}
        <Box component="span" data-theme-role="editorSelection" sx={{ bgcolor: v("terminal-selectionBackground") }}>
          srl1
        </Box>{" "}
        <Box component="span" data-theme-role="ansi.yellow" sx={{ color: v("terminal-ansiYellow") }}>
          v24.10
        </Box>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, 14px)", gap: "3px", mt: 0.5 }}>
        {Object.entries(TERMINAL_ANSI_TOKENS).map(([name, token]) => (
          <Box key={token} data-theme-role={`ansi.${name}`} sx={{ height: 8, borderRadius: "2px", bgcolor: `var(${token})` }} />
        ))}
      </Box>
    </Box>
  );
}

function SidePanel() {
  return (
    <Box
      data-theme-role="surface"
      sx={{
        width: "30%",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        bgcolor: v("sideBar-background"),
        color: v("sideBar-foreground"),
        borderLeft: `1px solid ${v("panel-border")}`,
        overflow: "hidden"
      }}
    >
      <Box sx={{ display: "flex", gap: 1.5, px: 1.25, borderBottom: `1px solid ${v("panel-border")}` }}>
        <Box
          data-theme-role="accent"
          sx={{ py: 0.625, color: v("tab-activeForeground"), borderBottom: `2px solid ${v("button-background")}`, fontWeight: 600 }}
        >
          Nodes
        </Box>
        <Box data-theme-role="muted" sx={{ py: 0.625, color: v("tab-inactiveForeground") }}>
          YAML
        </Box>
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1.25, minWidth: 0 }}>
        <Box
          data-theme-role="input"
          sx={{
            px: 0.875,
            py: 0.5,
            borderRadius: "4px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            bgcolor: v("input-background"),
            border: `1px solid ${v("input-border")}`,
            color: v("input-placeholderForeground")
          }}
        >
          Search nodes…
        </Box>
        <Box
          data-theme-role="border"
          sx={{ px: 0.875, py: 0.625, borderRadius: "4px", border: `1px solid ${v("panel-border")}`, whiteSpace: "nowrap", overflow: "hidden" }}
        >
          <Box data-theme-role="foreground" sx={{ fontWeight: 600 }}>SR Linux</Box>
          <Box data-theme-role="muted" sx={{ fontSize: 10, color: v("descriptionForeground") }}>
            nokia_srlinux
          </Box>
        </Box>
        <Box sx={{ display: "flex", gap: 0.75 }}>
          <Box
            data-theme-role="accent"
            sx={{ px: 1, py: 0.375, borderRadius: "4px", bgcolor: v("button-background"), color: v("button-foreground"), fontWeight: 600 }}
          >
            Deploy
          </Box>
          <Box
            data-theme-role="raised"
            sx={{ px: 1, py: 0.375, borderRadius: "4px", bgcolor: v("button-secondaryBackground"), color: v("button-secondaryForeground") }}
          >
            Edit
          </Box>
        </Box>
        {STATUS_LINES.map((line) => (
          <Box
            key={line.label}
            data-theme-role={line.role}
            sx={{ display: "flex", alignItems: "center", gap: 0.625, fontSize: 11, color: v(line.token) }}
          >
            <Dot token={line.token} role={line.role} />
            {line.label}
          </Box>
        ))}
        <Box data-theme-role="link" sx={{ fontSize: 11, color: v("textLink-foreground"), textDecoration: "underline" }}>
          View logs
        </Box>
      </Box>
    </Box>
  );
}

function roleAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("[data-theme-role]")?.dataset.themeRole ?? null;
}

/**
 * A miniature workspace painted only from `vars`, so it shows any theme without touching
 * the app's own colors. Pointing at a part reports the color role that paints it.
 */
export function ThemePreview({
  vars,
  height = 360,
  onPick,
  onHover
}: {
  vars: VarMap;
  height?: number;
  onPick: (role: string) => void;
  onHover: (role: string | null) => void;
}) {
  return (
    <Box
      aria-hidden
      data-testid="theme-preview"
      style={vars}
      onClick={(event) => {
        const role = roleAt(event.target);
        if (role !== null) onPick(role);
      }}
      onMouseOver={(event) => onHover(roleAt(event.target))}
      onMouseLeave={() => onHover(null)}
      sx={{
        display: "flex",
        width: "100%",
        height,
        overflow: "hidden",
        cursor: "pointer",
        fontFamily: v("font-family"),
        fontSize: 12,
        lineHeight: 1.4,
        textAlign: "left",
        userSelect: "none",
        color: v("foreground"),
        bgcolor: v("editor-background"),
        border: `1px solid ${v("panel-border")}`,
        borderRadius: floatingRadius,
        // Outline only the innermost part under the pointer, in the preview's own text
        // color so it stands out on any of its backgrounds.
        "& [data-theme-role]:hover:not(:has([data-theme-role]:hover))": {
          outline: `1px dashed ${v("foreground")}`,
          outlineOffset: "1px"
        }
      }}
    >
      <Rail />
      <Explorer />
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Canvas />
        <Terminal />
      </Box>
      <SidePanel />
    </Box>
  );
}
