import React, { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import Tooltip from "@mui/material/Tooltip";
import { SettingsField } from "./SettingsField";
import CheckIcon from "@mui/icons-material/Check";
import { SettingInput } from "./SettingInput";
import {
  validateSettingsChange,
  type SettingDefinition,
  type SettingValue,
  type SettingsChange,
  type SettingsTarget,
} from "./schema";

function asText(value: unknown): string {
  return typeof value === "string"
    ? value
    : (JSON.stringify(value, null, 2) ?? "");
}
function parseValue(definition: SettingDefinition, text: string): unknown {
  if (definition.type === "string") return text;
  if (definition.type === "number")
    return text.trim() ? Number(text) : Number.NaN;
  return JSON.parse(text);
}
export function SettingCard({
  definition,
  current,
  target,
  onSave,
  onDirty,
  onRefresh,
}: {
  definition: SettingDefinition;
  current: SettingValue;
  target: SettingsTarget;
  onSave: (change: SettingsChange) => Promise<void>;
  onDirty: (key: string, dirty: boolean) => void;
  onRefresh: () => Promise<void>;
}) {
  const [text, setText] = useState(() => asText(current.value));
  const [baseline, setBaseline] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const dirty = text !== asText(baseline.value);
  const stale = JSON.stringify(current) !== JSON.stringify(baseline);
  useEffect(() => {
    if (!dirty) {
      setText(asText(current.value));
      setBaseline(current);
    }
  }, [current, dirty]);
  useEffect(() => {
    onDirty(definition.key, dirty);
    return () => onDirty(definition.key, false);
  }, [definition.key, dirty, onDirty]);
  let parsed: unknown;
  let validation: string | undefined;
  try {
    parsed = parseValue(definition, text);
    validation = validateSettingsChange(definition, parsed);
  } catch {
    validation = "Enter valid JSON before saving.";
  }
  const edit = (value: string) => {
    setText(value);
    setError("");
    setSaved(false);
  };
  const save = async (reset = false, value = parsed) => {
    setBusy(true);
    setError("");
    try {
      await onSave({
        key: definition.key,
        target,
        value,
        reset,
        expected: {
          overridden: baseline.overridden,
          scopeValue: baseline.scopeValue,
        },
      });
      // The incoming host snapshot supplies the inherited value after reset.
      setText(asText(reset ? baseline.value : value));
      setBaseline({ ...baseline, value: reset ? baseline.value : value });
      setSaved(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  let sourceLabel = target === "user" ? "Default" : "Inherited";
  if (current.overridden)
    sourceLabel = target === "user" ? "User" : "Workspace";
  const description = (
    definition.description ??
    definition.markdownDescription ??
    ""
  ).replace(/`|\*\*/g, "");
  const actions = (
    <Stack
      direction="row"
      spacing={0.5}
      sx={{ alignItems: "center", justifyContent: "flex-end" }}
    >
      {saved && !dirty && (
        <CheckIcon sx={{ fontSize: 15 }} color="success" titleAccess="Saved" />
      )}
      {dirty && (
        <Button
          size="small"
          variant="text"
          disabled={busy}
          onClick={() => {
            setText(asText(current.value));
            setBaseline(current);
            setError("");
          }}
        >
          Discard
        </Button>
      )}
      {!dirty && current.overridden && (
        <Button
          size="small"
          variant="text"
          startIcon={<RestartAltIcon sx={{ fontSize: 14 }} />}
          disabled={busy}
          onClick={() => {
            void save(true);
          }}
          sx={{
            py: 0,
            minHeight: 24,
            fontSize: "calc(0.7rem * var(--settings-font-scale, 1))",
          }}
        >
          Reset
        </Button>
      )}
      {dirty && (
        <Button
          size="small"
          disabled={busy || Boolean(validation) || stale}
          onClick={() => {
            void save();
          }}
        >
          {busy ? "Saving…" : "Save"}
        </Button>
      )}
    </Stack>
  );
  const feedback = (
    <Stack spacing={1}>
      {current.workspaceOverride && (
        <Alert severity="info" sx={{ py: 0 }}>
          This workspace overrides the User value. Select Workspace to change
          the value used here.
        </Alert>
      )}
      {dirty &&
        validation &&
        (definition.type === "object" || definition.type === "array") && (
          <Alert severity="error">{validation}</Alert>
        )}
      {stale && dirty && (
        <Alert
          severity="warning"
          action={
            <Button
              size="small"
              variant="text"
              onClick={() => {
                setText(asText(current.value));
                setBaseline(current);
              }}
            >
              Use latest
            </Button>
          }
        >
          The saved value changed elsewhere. Your draft is preserved.
        </Alert>
      )}
      {error && (
        <Alert
          severity="error"
          action={
            <Button
              variant="text"
              size="small"
              onClick={() => {
                void onRefresh().catch(() => undefined);
              }}
            >
              Refresh
            </Button>
          }
        >
          {error}
        </Alert>
      )}
    </Stack>
  );
  return (
    <SettingsField
      title={definition.title}
      description={description}
      settingKey={definition.key}
      dirty={dirty}
      wide={
        definition.type === "array" ||
        definition.type === "object" ||
        definition.key === "containerlab.appearance.colorScheme"
      }
      compactControl={definition.type === "boolean"}
      metadata={
        <>
          <Tooltip title={`${definition.key} · ${sourceLabel}`}>
            <Typography
              component="span"
              tabIndex={0}
              sx={{
                fontSize: "calc(0.65rem * var(--settings-font-scale, 1))",
                color: "text.secondary",
                cursor: "help",
              }}
            >
              ⓘ
            </Typography>
          </Tooltip>
          {current.overridden && (
            <Chip
              label={sourceLabel}
              size="small"
              variant="outlined"
              sx={{
                height: 17,
                fontSize: "calc(0.6rem * var(--settings-font-scale, 1))",
              }}
            />
          )}
          {definition.reloadRequired && (
            <Typography
              variant="caption"
              sx={{
                fontSize: "calc(0.65rem * var(--settings-font-scale, 1))",
                color: "text.secondary",
              }}
            >
              Reload to apply
            </Typography>
          )}
        </>
      }
      actions={dirty || current.overridden || saved ? actions : undefined}
      feedback={
        current.workspaceOverride ||
        (dirty &&
          validation &&
          ["object", "array"].includes(definition.type)) ||
        (stale && dirty) ||
        error
          ? feedback
          : undefined
      }
    >
      {definition.type === "boolean" ? (
        <Switch
          size="small"
          sx={{
            "& .MuiSwitch-track": {
              bgcolor: "text.secondary",
              opacity: 0.4,
            },
          }}
          checked={text === "true"}
          disabled={busy}
          onChange={(_, checked) => edit(String(checked))}
          slotProps={{ input: { "aria-label": definition.title } }}
        />
      ) : (
        <SettingInput
          definition={definition}
          text={text}
          onChange={edit}
          busy={busy}
          validation={dirty ? validation : undefined}
        />
      )}
    </SettingsField>
  );
}
