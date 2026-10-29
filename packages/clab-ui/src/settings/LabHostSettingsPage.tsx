// One lab host's page in the settings: the same sections for every host,
// each setting editable, greyed out with the reason, or shown read-only as
// the API Server sets it. Which is which comes from `labHostSettingAccess`;
// the apps hand in the values and store the changes.
import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";

import { RuntimeLimited } from "../components/ui/form/RuntimeLimited";
import {
  LAB_HOST_SETTINGS,
  LAB_HOST_SETTING_SECTIONS,
  labHostSettingAccess,
  type LabHostSettingAccess,
  type LabHostSettingDefinition,
  type LabHostSettingId,
  type LabHostSettingRow,
  type LabHostSettingRows,
  type LabHostSettingValue,
  type LabHostSettingsSubject
} from "../host/labHostSettings";
import { MONO_FONT_FAMILY } from "../theme/typography";
import { SettingsField } from "./SettingsField";

export type { LabHostSettingRows };

type Change = (id: LabHostSettingId, value: LabHostSettingValue | undefined) => Promise<void>;

function ChangedTag(props: { onReset?: () => void; busy: boolean }) {
  return (
    <>
      <Chip
        size="small"
        label="changed for this host"
        data-testid="lab-host-setting-changed"
        sx={{ height: 18, fontSize: 11, bgcolor: "warning.main", color: "warning.contrastText", opacity: 0.85 }}
      />
      {props.onReset ? (
        <Button size="small" variant="text" onClick={props.onReset} disabled={props.busy} sx={{ minWidth: 0, py: 0, px: 0.5 }}>
          Reset
        </Button>
      ) : null}
    </>
  );
}

function LockedReason(props: { reason: string }) {
  return (
    <Typography variant="caption" sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "text.secondary" }}>
      <LockOutlinedIcon sx={{ fontSize: 13 }} aria-hidden />
      {props.reason}
    </Typography>
  );
}

function ReadOnlyValue(props: { value: string; reason: string; testId: string }) {
  return (
    <Stack spacing={0.5} sx={{ alignItems: "stretch", width: "100%" }} data-testid={props.testId}>
      <TextField
        size="small"
        value={props.value}
        disabled
        fullWidth
        slotProps={{ htmlInput: { "aria-label": props.reason } }}
        sx={{ "& .MuiOutlinedInput-notchedOutline": { borderStyle: "dashed" } }}
      />
      <LockedReason reason={props.reason} />
    </Stack>
  );
}

function asText(value: LabHostSettingValue | undefined): string {
  return value === undefined ? "" : String(value);
}

/** A text or number field that saves when it loses focus or on Enter. */
function CommittedText(props: {
  definition: LabHostSettingDefinition;
  row: LabHostSettingRow;
  busy: boolean;
  onCommit: (value: LabHostSettingValue | undefined) => void;
}) {
  const { definition, row } = props;
  const [text, setText] = useState(asText(row.value));
  useEffect(() => setText(asText(row.value)), [row.value]);
  const number = definition.control.type === "number";
  let parsed: LabHostSettingValue | undefined = text.trim();
  if (parsed === "") parsed = undefined;
  else if (number) parsed = Number(text);
  const error = parsed === undefined ? undefined : definition.validate?.(parsed);
  const commit = () => {
    if (error || asText(parsed) === asText(row.value)) return;
    props.onCommit(parsed);
  };
  const monospace = definition.control.type === "text" && definition.control.monospace === true;
  return (
    <TextField
      size="small"
      fullWidth
      value={text}
      placeholder={row.defaultLabel}
      disabled={props.busy}
      error={error !== undefined}
      helperText={error ?? row.note}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      slotProps={{
        htmlInput: {
          "aria-label": definition.title,
          spellCheck: false,
          ...(number ? { inputMode: "numeric" } : {})
        }
      }}
      sx={monospace ? { "& input": { fontFamily: MONO_FONT_FAMILY, fontSize: 12 } } : undefined}
    />
  );
}

const DEFAULT_OPTION = "__default__";

function SettingControl(props: {
  definition: LabHostSettingDefinition;
  row: LabHostSettingRow;
  busy: boolean;
  onCommit: (value: LabHostSettingValue | undefined) => void;
}) {
  const { definition, row, busy, onCommit } = props;
  const control = definition.control;
  if (control.type === "switch") {
    const fallback = row.defaultLabel === "On";
    return (
      <Switch
        size="small"
        checked={row.value === undefined ? fallback : row.value === true}
        disabled={busy}
        onChange={(event) => onCommit(event.target.checked === fallback ? undefined : event.target.checked)}
        slotProps={{ input: { "aria-label": definition.title } }}
      />
    );
  }
  if (control.type === "select") {
    const defaultText = control.options.find((option) => option.value === row.defaultLabel)?.label ?? row.defaultLabel;
    return (
      <TextField
        select
        size="small"
        fullWidth
        disabled={busy}
        value={row.value === undefined ? DEFAULT_OPTION : String(row.value)}
        helperText={row.note}
        onChange={(event) => onCommit(event.target.value === DEFAULT_OPTION ? undefined : event.target.value)}
        slotProps={{ select: { inputProps: { "aria-label": definition.title } } }}
      >
        <MenuItem value={DEFAULT_OPTION}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {defaultText ? `Default: ${defaultText}` : "Default"}
          </Typography>
        </MenuItem>
        {control.options.map((option) => {
          const unavailable = row.unavailableOptions?.[option.value];
          return (
            <MenuItem key={option.value} value={option.value} disabled={unavailable !== undefined}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2">{option.label}</Typography>
                {unavailable ? (
                  <Typography variant="caption" sx={{ color: "text.secondary", display: "block", whiteSpace: "normal" }}>
                    {unavailable}
                  </Typography>
                ) : null}
              </Box>
            </MenuItem>
          );
        })}
      </TextField>
    );
  }
  return <CommittedText definition={definition} row={row} busy={busy} onCommit={onCommit} />;
}

function displayValue(row: LabHostSettingRow | undefined, access: LabHostSettingAccess): string {
  if (access.access === "server") return access.value ?? "Not reported";
  return row?.shown ?? (row?.value !== undefined ? String(row.value) : (row?.defaultLabel ?? ""));
}

function SettingRow(props: {
  id: LabHostSettingId;
  subject: LabHostSettingsSubject;
  row: LabHostSettingRow | undefined;
  custom?: React.ReactNode;
  onChange: Change;
}) {
  const { id, row } = props;
  const definition = LAB_HOST_SETTINGS[id];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  let access = labHostSettingAccess(id, props.subject);
  if (access.access === "edit" && row?.fixed !== undefined) access = { access: "fixed", reason: row.fixed };
  const commit = (value: LabHostSettingValue | undefined) => {
    setBusy(true);
    setError(undefined);
    props.onChange(id, value).then(
      () => setBusy(false),
      (reason: unknown) => {
        setBusy(false);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    );
  };
  if (access.access === "unsupported") {
    return (
      <Box data-testid={`lab-host-setting-${id}`} data-access="unsupported">
        <RuntimeLimited limit={{ level: "unsupported", reason: access.reason }}>
          <SettingsField title={definition.title} description={definition.description}>
            <TextField size="small" disabled fullWidth value="" slotProps={{ htmlInput: { "aria-label": definition.title } }} />
          </SettingsField>
        </RuntimeLimited>
      </Box>
    );
  }
  if (access.access === "server" || access.access === "fixed") {
    if (access.access === "fixed" && row === undefined && props.custom === undefined) return null;
    return (
      <Box data-testid={`lab-host-setting-${id}`} data-access={access.access}>
        <SettingsField title={definition.title} description={definition.description} wide={props.custom !== undefined}>
          {props.custom !== undefined ? (
            <>
              {props.custom}
              <LockedReason reason={access.reason} />
            </>
          ) : (
            <ReadOnlyValue value={displayValue(row, access)} reason={access.reason} testId={`lab-host-setting-${id}-value`} />
          )}
        </SettingsField>
      </Box>
    );
  }
  // Editable: the app draws it, or it has a value to edit; otherwise the app does not offer it.
  if (props.custom === undefined && row === undefined) return null;
  const changed = row?.value !== undefined && definition.control.type !== "custom";
  return (
    <Box data-testid={`lab-host-setting-${id}`} data-access="edit">
      <SettingsField
        title={definition.title}
        description={definition.description}
        wide={definition.control.type === "custom"}
        compactControl={definition.control.type === "switch"}
        metadata={changed ? <ChangedTag busy={busy} onReset={() => commit(undefined)} /> : undefined}
        feedback={error ? <Typography variant="caption" sx={{ color: "error.main" }}>{error}</Typography> : undefined}
      >
        {props.custom ?? (row ? <SettingControl definition={definition} row={row} busy={busy} onCommit={commit} /> : null)}
      </SettingsField>
    </Box>
  );
}

/** Whether a section has anything to show on this host. */
function sectionVisible(
  settings: readonly LabHostSettingId[],
  subject: LabHostSettingsSubject,
  rows: LabHostSettingRows,
  custom: Partial<Record<LabHostSettingId, React.ReactNode>>
): boolean {
  return settings.some((id) => {
    const access = labHostSettingAccess(id, subject).access;
    return access === "unsupported" || access === "server" || rows[id] !== undefined || custom[id] !== undefined;
  });
}

/**
 * The settings of one lab host under its header (name, kind, sign in,
 * connection, remove): Containerlab, Connection, Deploy defaults, Capture.
 */
export function LabHostSettingsPage(props: {
  subject: LabHostSettingsSubject;
  rows: LabHostSettingRows;
  onChange: Change;
  /** Controls the app draws itself, e.g. Edgeshark's status and buttons. */
  custom?: Partial<Record<LabHostSettingId, React.ReactNode>>;
  header?: React.ReactNode;
}) {
  const custom = props.custom ?? {};
  return (
    <Stack spacing={3} data-testid="lab-host-settings-page" data-kind={props.subject.kind}>
      {props.header}
      {props.subject.kind === "server" ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Most of these the API Server sets; they show read-only, so you know what applies to your labs there.
        </Typography>
      ) : null}
      {LAB_HOST_SETTING_SECTIONS.filter((section) => sectionVisible(section.settings, props.subject, props.rows, custom)).map(
        (section) => (
          <Box key={section.id} component="section" aria-label={section.title} data-testid={`lab-host-section-${section.id}`}>
            <Typography component="h3" variant="overline" sx={{ display: "block", color: "text.secondary", mb: 1 }}>
              {section.title}
            </Typography>
            <Box
              sx={{
                display: "grid",
                rowGap: 2,
                "& > div + div": { pt: 2, borderTop: 1, borderColor: "divider" }
              }}
            >
              {section.settings.map((id) => (
                <SettingRow
                  key={id}
                  id={id}
                  subject={props.subject}
                  row={props.rows[id]}
                  custom={custom[id]}
                  onChange={props.onChange}
                />
              ))}
            </Box>
          </Box>
        )
      )}
    </Stack>
  );
}
