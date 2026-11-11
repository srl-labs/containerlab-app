import React, { useState } from "react";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";

import { controlRadius } from "../../theme/surfaces";
import { StatusDot, type Tone } from "./imagesUi";
import type { ImagesDoctorCheck, ImagesStatus } from "./types";

function checkTone(check: ImagesDoctorCheck): Tone {
  const status = check.status.toUpperCase();
  if (status === "OK") return "success";
  if (status === "FAIL") return "error";
  return "warning";
}

function summary(checks: ImagesDoctorCheck[]): { tone: Tone; text: string } {
  const failed = checks.filter((check) => checkTone(check) === "error").length;
  const warned = checks.filter((check) => checkTone(check) === "warning").length;
  if (failed > 0) return { tone: "error", text: `${failed} of ${checks.length} checks failed` };
  if (warned > 0) return { tone: "warning", text: `All checks pass, ${warned} with a warning` };
  return { tone: "success", text: `All ${checks.length} checks pass` };
}

/** `climg doctor` on the lab host: what is missing turns the actions that need it off. */
export function HealthCard({ status }: { status: ImagesStatus }): React.JSX.Element {
  const { checks, checkedAt } = status.doctor;
  const head = summary(checks);
  // Problems are shown at once; a healthy host folds to one line.
  const [open, setOpen] = useState(head.tone !== "success");
  const checked = new Date(checkedAt);
  return (
    <Box
      component="section"
      aria-label="Host health"
      data-testid="images-health"
      data-ok={String(status.doctor.ok)}
      sx={{
        mx: 1.5, mt: 1.5, mb: 0.5, border: 1, borderRadius: "9px", bgcolor: "background.paper", flexShrink: 0, overflow: "hidden",
        borderColor: head.tone === "error"
          ? "color-mix(in srgb, var(--vscode-editorError-foreground) 55%, var(--clab-ui-panel-border, var(--vscode-panel-border)))"
          : "divider"
      }}
    >
      <ButtonBase
        aria-expanded={open}
        aria-controls="images-health-checks"
        onClick={() => setOpen(!open)}
        sx={{
          display: "flex", alignItems: "center", gap: 1, width: "100%", px: 1.25, py: 1, textAlign: "left", borderRadius: controlRadius,
          "&.Mui-focusVisible": { outline: "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))", outlineOffset: -1 }
        }}
      >
        <StatusDot tone={head.tone} label={head.text} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>Host · climg {status.climgVersion}</Typography>
          <Typography variant="caption" component="p" sx={{ color: head.tone === "error" ? "error.main" : "text.secondary" }} noWrap>
            {head.text}
          </Typography>
        </Box>
        <ExpandMoreIcon fontSize="small" sx={{
          color: "text.secondary", transform: open ? "none" : "rotate(-90deg)", transition: "transform 120ms ease",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" }
        }} />
      </ButtonBase>
      <Box
        id="images-health-checks"
        component="ul"
        sx={{ m: 0, px: 1.25, pb: 1, pt: 0.25, display: open ? "grid" : "none", gap: 0.5, borderTop: 1, borderColor: "divider" }}
      >
        {checks.map((check) => (
          <Box
            key={check.check}
            component="li"
            data-testid="images-health-check"
            data-status={check.status}
            sx={{ listStyle: "none", display: "grid", gridTemplateColumns: "8px minmax(72px, auto) minmax(0, 1fr)", alignItems: "center", columnGap: 1, pt: 0.5 }}
          >
            <StatusDot tone={checkTone(check)} label={check.status} />
            <Typography variant="caption" sx={{ fontWeight: 500 }} noWrap>{check.check}</Typography>
            <Typography
              variant="caption"
              noWrap
              title={check.detail}
              sx={{ color: checkTone(check) === "error" ? "error.main" : "text.secondary", minWidth: 0 }}
            >
              {check.detail || check.status}
            </Typography>
          </Box>
        ))}
        {Number.isNaN(checked.getTime()) ? null : (
          <Typography component="li" variant="caption" sx={{ listStyle: "none", color: "text.disabled", pt: 0.5 }}>
            Checked {checked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
