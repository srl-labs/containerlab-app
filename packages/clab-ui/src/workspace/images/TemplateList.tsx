import React from "react";
import SyncOutlinedIcon from "@mui/icons-material/SyncOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { controlRadius } from "../../theme/surfaces";
import { MONO_SX, PaneTitle, StatusDot, type Tone } from "./imagesUi";
import type { ImagesTemplate } from "./types";

export function presenceOf(template: ImagesTemplate): { key: "true" | "false" | "unknown"; tone: Tone; label: string } {
  if (template.imagePresent === true) return { key: "true", tone: "success", label: "Image on this host" };
  if (template.imagePresent === false) return { key: "false", tone: "warning", label: "Image missing on this host" };
  return { key: "unknown", tone: "default", label: "Image not tracked by climg" };
}

const CUSTOMIZED_TIP = "You edited this template. climg keeps your edited fields when it regenerates the template.";

function TemplateRow({ template, selected, onSelect }: {
  template: ImagesTemplate;
  selected: boolean;
  onSelect: (template: ImagesTemplate) => void;
}) {
  const presence = presenceOf(template);
  return (
    <Box component="li" sx={{ listStyle: "none" }}>
      <ButtonBase
        data-testid="images-template-row"
        data-name={template.name}
        data-managed={String(template.managed)}
        data-customized={String(template.managed && template.customized === true)}
        data-present={presence.key}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(template)}
        sx={{
          display: "flex", alignItems: "flex-start", gap: 1, width: "100%", textAlign: "left", px: 1, py: 0.75,
          borderRadius: controlRadius, color: "text.primary",
          bgcolor: selected ? "action.selected" : "transparent",
          "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" },
          "&.Mui-focusVisible": { outline: "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))", outlineOffset: -1 }
        }}
      >
        <Tooltip title={presence.label}>
          <Box sx={{ pt: "6px" }}><StatusDot tone={presence.tone} label={presence.label} /></Box>
        </Tooltip>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
            <Typography variant="body2" noWrap title={template.name} sx={{ fontWeight: 500, minWidth: 0 }}>{template.name}</Typography>
            {template.managed ? (
              <Typography
                component="span"
                variant="caption"
                title="Created by climg; the Images view can remove it"
                sx={{
                  flexShrink: 0, px: 0.5, lineHeight: "16px", borderRadius: "4px", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.02em",
                  color: "primary.main", border: 1, borderColor: "currentColor"
                }}
              >
                climg
              </Typography>
            ) : null}
            {template.managed && template.customized === true ? (
              <Tooltip title={CUSTOMIZED_TIP}>
                <Typography
                  component="span"
                  variant="caption"
                  data-testid="images-template-customized"
                  sx={{
                    flexShrink: 0, px: 0.5, lineHeight: "16px", borderRadius: "4px", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.02em",
                    color: "warning.main", border: 1, borderColor: "currentColor"
                  }}
                >
                  customized
                </Typography>
              </Tooltip>
            ) : null}
          </Box>
          <Typography variant="caption" component="p" noWrap title={template.image} sx={{ color: "text.secondary", ...MONO_SX }}>
            {template.kind}{template.image ? ` · ${template.image}` : ""}
          </Typography>
        </Box>
      </ButtonBase>
    </Box>
  );
}

/** The Node Templates the Lab Palette offers, with whether their images are on this host. */
export function TemplateList({ templates, loading, error, selectedName, syncDisabledReason, onSelect, onSync }: {
  templates: ImagesTemplate[];
  loading: boolean;
  error?: string;
  selectedName?: string;
  syncDisabledReason?: string;
  onSelect: (template: ImagesTemplate) => void;
  onSync: () => void;
}): React.JSX.Element {
  const missing = templates.filter((template) => template.imagePresent === false).length;
  return (
    <Box component="section" aria-labelledby="images-templates-title" data-testid="images-templates" sx={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <PaneTitle
        id="images-templates-title"
        title="Node Templates"
        count={templates.length}
        actions={(
          <Tooltip title={syncDisabledReason ?? "Preview, then write the templates of every built image"}>
            <span>
              <Button
                size="small"
                variant="text"
                startIcon={<SyncOutlinedIcon fontSize="small" />}
                data-testid="images-sync-button"
                disabled={syncDisabledReason !== undefined}
                onClick={onSync}
                sx={{ minWidth: 0, px: 1 }}
              >
                Sync
              </Button>
            </span>
          </Tooltip>
        )}
      />
      {missing > 0 ? (
        <Typography variant="caption" sx={{ px: 1.5, pb: 0.5, color: "warning.main" }}>
          {missing} {missing === 1 ? "template uses an image" : "templates use images"} not on this host
        </Typography>
      ) : null}
      {error ? <Typography variant="body2" sx={{ px: 1.5, color: "error.main" }}>{error}</Typography> : null}
      {loading && templates.length === 0 ? <Typography variant="body2" sx={{ px: 1.5, color: "text.secondary" }}>Loading templates…</Typography> : null}
      {!loading && !error && templates.length === 0 ? (
        <Typography variant="body2" sx={{ px: 1.5, color: "text.secondary" }}>
          No Node Templates yet. A pull or build adds one for its image.
        </Typography>
      ) : null}
      <Box component="ul" sx={{ m: 0, px: 0.75, pb: 1, overflowY: "auto", minHeight: 0, flex: 1 }}>
        {templates.map((template) => (
          <TemplateRow key={template.name} template={template} selected={template.name === selectedName} onSelect={onSelect} />
        ))}
      </Box>
    </Box>
  );
}
