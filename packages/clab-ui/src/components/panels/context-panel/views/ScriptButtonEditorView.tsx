import React, { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import type { ScriptButtonAnnotation, ScriptButtonOutputMode } from "../../../../core/types/topology";
import { useTopologySessionClient } from "../../../../host";
import { findScriptButton, updateScriptButtonNode } from "../../../../scriptButtons/useScriptButtons";
import { SCRIPT_BUTTON_ICONS } from "../../../../scriptButtons/scriptButtonIcons";
import { saveAnnotationNodesFromGraph } from "../../../../services";
import { useAnnotationUIStore } from "../../../../stores/annotationUIStore";
import { useGraphStore } from "../../../../stores/graphStore";
import { MONO_FONT_FAMILY } from "../../../../theme/typography";
import { ColorField, InputField, PanelSection, SelectField } from "../../../ui/form";
import { ReadOnlyFieldset } from "../../../ui/editor/ReadOnlyFieldset";

const SAVE_DELAY_MS = 400;

const OUTPUT_OPTIONS: Array<{ value: ScriptButtonOutputMode; label: string }> = [
  { value: "terminal", label: "Terminal" },
  { value: "dialog", label: "Dialog" },
  { value: "toast", label: "Notification only" }
];

const ICON_OPTIONS = SCRIPT_BUTTON_ICONS.map(({ value, label, Icon }) => ({
  value,
  label,
  icon: <Icon fontSize="small" />
}));

type Source = "file" | "inline";

const SOURCE_OPTIONS: Array<{ value: Source; label: string }> = [
  { value: "file", label: "Script file" },
  { value: "inline", label: "Inline script" }
];

function parseTimeout(text: string): number | undefined {
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Edits the script button whose editor is open; changes apply on the canvas as you type. */
export const ScriptButtonEditorView: React.FC<{ readOnly?: boolean }> = ({ readOnly = false }) => {
  const sessionClient = useTopologySessionClient();
  const id = useAnnotationUIStore((state) => state.editingScriptButtonId);
  // Re-read when the graph changes, e.g. undo or the file changing on disk.
  const exists = useGraphStore((state) => id !== null && state.nodes.some((node) => node.id === id));
  const [form, setForm] = useState<ScriptButtonAnnotation | undefined>(() =>
    id !== null ? findScriptButton(id) : undefined
  );
  const [source, setSource] = useState<Source>(() =>
    (form?.script ?? "") !== "" && (form?.scriptPath ?? "") === "" ? "inline" : "file"
  );
  const [timeoutText, setTimeoutText] = useState(() => form?.timeoutSeconds?.toString() ?? "");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const next = id !== null ? findScriptButton(id) : undefined;
    setForm(next);
    setTimeoutText(next?.timeoutSeconds?.toString() ?? "");
    setSource((next?.script ?? "") !== "" && (next?.scriptPath ?? "") === "" ? "inline" : "file");
  }, [id, exists]);

  useEffect(
    () => () => {
      if (saveTimer.current === null) return;
      clearTimeout(saveTimer.current);
      void saveAnnotationNodesFromGraph(sessionClient, undefined, { applySnapshot: false });
    },
    [sessionClient]
  );

  if (id === null || form === undefined) {
    return (
      <Typography variant="body2" sx={{ p: 2, color: "text.secondary" }}>
        Script button deleted.
      </Typography>
    );
  }

  const apply = (updates: Partial<ScriptButtonAnnotation>) => {
    setForm((current) => (current ? { ...current, ...updates } : current));
    if (!updateScriptButtonNode(id, updates)) return;
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      void saveAnnotationNodesFromGraph(sessionClient, undefined, { applySnapshot: false });
    }, SAVE_DELAY_MS);
  };

  // Only one source is kept, so switching never leaves a stale script behind.
  const changeSource = (next: Source) => {
    if (next === source) return;
    setSource(next);
    apply(next === "file" ? { script: undefined } : { scriptPath: undefined });
  };

  return (
    <Box sx={{ flex: 1, overflow: "auto" }} data-testid="script-button-editor">
      <ReadOnlyFieldset readOnly={readOnly}>
        <PanelSection title="Button">
          <InputField
            id="script-button-label"
            label="Label"
            value={form.label}
            onChange={(value) => apply({ label: value })}
          />
          <SelectField
            id="script-button-icon"
            label="Icon"
            value={form.icon ?? "play"}
            onChange={(value) => apply({ icon: value === "play" ? undefined : value })}
            options={ICON_OPTIONS}
          />
          <ColorField
            label="Color"
            value={form.color ?? ""}
            onChange={(value) => apply({ color: value || undefined })}
          />
        </PanelSection>
        <PanelSection title="Script">
          <SelectField
            id="script-button-source"
            label="Source"
            value={source}
            onChange={(value) => changeSource(value === "inline" ? "inline" : "file")}
            options={SOURCE_OPTIONS}
          />
          {source === "file" ? (
            <InputField
              id="script-button-path"
              label="Script path"
              value={form.scriptPath ?? ""}
              onChange={(value) => apply({ scriptPath: value || undefined })}
              placeholder="e.g., scripts/reset.sh"
            />
          ) : (
            <TextField
              id="script-button-script"
              label="Script"
              multiline
              minRows={6}
              value={form.script ?? ""}
              onChange={(event) => apply({ script: event.target.value || undefined })}
              placeholder="echo hello"
              slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: MONO_FONT_FAMILY, fontSize: 12 } } }}
            />
          )}
        </PanelSection>
        <PanelSection title="Run">
          <SelectField
            id="script-button-output"
            label="Show output in"
            value={form.output ?? "terminal"}
            onChange={(value) => {
              const output = OUTPUT_OPTIONS.find((option) => option.value === value)?.value;
              if (output) apply({ output });
            }}
            options={OUTPUT_OPTIONS}
          />
          <InputField
            id="script-button-timeout"
            label="Timeout"
            type="number"
            min={1}
            suffix="s"
            value={timeoutText}
            onChange={(value) => {
              setTimeoutText(value);
              apply({ timeoutSeconds: parseTimeout(value) });
            }}
            placeholder="No limit"
          />
        </PanelSection>
      </ReadOnlyFieldset>
    </Box>
  );
};
