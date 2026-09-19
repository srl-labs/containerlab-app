import React, { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import CodeIcon from "@mui/icons-material/Code";
import ViewListIcon from "@mui/icons-material/ViewList";
import { isSettingsRecord, type SettingDefinition } from "./schema";

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
export function StructuredSettingEditor({
  definition,
  text,
  onChange,
  disabled,
}: {
  definition: SettingDefinition;
  text: string;
  onChange: (text: string) => void;
  disabled: boolean;
}) {
  const [json, setJson] = useState(false);
  const [rowError, setRowError] = useState("");
  const parsed = parse(text);
  const mapping =
    definition.type === "object" && isSettingsRecord(parsed)
      ? parsed
      : undefined;
  const templates =
    definition.key === "containerlab.editor.customNodes" &&
    Array.isArray(parsed) &&
    parsed.every(isSettingsRecord)
      ? parsed
      : undefined;
  const canUseForm = Boolean(mapping || templates);
  const update = (value: unknown) => {
    setRowError("");
    onChange(JSON.stringify(value, null, 2));
  };
  return (
    <Stack spacing={1.5}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {templates
            ? `${templates.length} reusable node templates`
            : "Map each node kind to its preferred value."}
        </Typography>
        <Button
          variant="text"
          size="small"
          startIcon={json ? <ViewListIcon /> : <CodeIcon />}
          disabled={!canUseForm || disabled}
          onClick={() => setJson(!json)}
        >
          {json ? "Form editor" : "Edit JSON"}
        </Button>
      </Box>
      {json || !canUseForm ? (
        <TextField
          label={`${definition.title} JSON`}
          multiline
          minRows={8}
          maxRows={24}
          fullWidth
          value={text}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          slotProps={{
            input: {
              sx: {
                fontFamily: "var(--vscode-editor-font-family, monospace)",
                fontSize: "calc(0.82rem * var(--settings-font-scale, 1))",
              },
            },
          }}
        />
      ) : null}
      {!json && mapping && (
        <Stack spacing={1}>
          {Object.entries(mapping).map(([kind, value], index) => (
            <Stack
              key={index}
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ alignItems: "center" }}
            >
              <TextField
                label={`Node kind ${index + 1}`}
                size="small"
                value={kind}
                disabled={disabled}
                fullWidth
                onChange={(event) => {
                  const entries = Object.entries(mapping);
                  if (
                    entries.some(
                      ([key], i) => i !== index && key === event.target.value,
                    )
                  ) {
                    setRowError("Each node kind must be unique.");
                    return;
                  }
                  entries[index] = [event.target.value, value];
                  update(Object.fromEntries(entries));
                }}
              />
              <TextField
                label={
                  definition.key.endsWith("sshUserMapping")
                    ? `SSH user ${index + 1}`
                    : `Command ${index + 1}`
                }
                size="small"
                value={value}
                disabled={disabled}
                fullWidth
                onChange={(event) =>
                  update({ ...mapping, [kind]: event.target.value })
                }
              />
              <IconButton
                aria-label={`Remove mapping ${index + 1}`}
                disabled={disabled}
                onClick={() =>
                  update(
                    Object.fromEntries(
                      Object.entries(mapping).filter(([key]) => key !== kind),
                    ),
                  )
                }
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          {!Object.keys(mapping).length && (
            <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
              Built-in defaults are used. Add a mapping to override a node kind.
            </Typography>
          )}
          <Box>
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              disabled={disabled || "" in mapping}
              onClick={() => update({ ...mapping, "": "" })}
            >
              Add mapping
            </Button>
          </Box>
        </Stack>
      )}
      {!json && templates && (
        <Stack spacing={1.5}>
          {templates.map((template, index) => (
            <Box
              key={index}
              sx={{
                p: 2,
                border: 1,
                borderColor: "divider",
                borderRadius: 1.5,
                bgcolor: "background.default",
              }}
            >
              <Stack
                direction="row"
                sx={{
                  alignItems: "center",
                  justifyContent: "space-between",
                  mb: 1.5,
                }}
              >
                <Typography variant="subtitle2">
                  {String(template.name || "New template")}
                </Typography>
                <IconButton
                  aria-label={`Remove template ${index + 1}`}
                  size="small"
                  disabled={disabled}
                  onClick={() =>
                    update(templates.filter((_, i) => i !== index))
                  }
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Stack>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                  gap: 1.5,
                }}
              >
                {(
                  [
                    "name",
                    "kind",
                    "type",
                    "image",
                    "icon",
                    "baseName",
                    "interfacePattern",
                  ] as const
                ).map((field) => (
                  <TextField
                    key={field}
                    label={`${{ name: "Name", kind: "Node kind", type: "Device type", image: "Container image", icon: "Icon", baseName: "Base name", interfacePattern: "Interface pattern" }[field]} · ${index + 1}`}
                    size="small"
                    value={template[field] ?? ""}
                    disabled={disabled}
                    onChange={(event) =>
                      update(
                        templates.map((entry, i) =>
                          i === index
                            ? { ...entry, [field]: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                ))}
              </Box>
              <FormControlLabel
                sx={{ mt: 1 }}
                label="Use as default template"
                control={
                  <Checkbox
                    size="small"
                    disabled={disabled}
                    checked={template.setDefault === true}
                    onChange={(_, checked) =>
                      update(
                        templates.map((entry, i) => ({
                          ...entry,
                          setDefault: i === index ? checked : false,
                        })),
                      )
                    }
                  />
                }
              />
              {Object.keys(template).some(
                (key) =>
                  ![
                    "name",
                    "kind",
                    "type",
                    "image",
                    "icon",
                    "baseName",
                    "interfacePattern",
                    "setDefault",
                  ].includes(key),
              ) && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block" }}
                >
                  Additional configuration is preserved. Use Edit JSON to change
                  startup configs, binds, environment variables, and other
                  fields.
                </Typography>
              )}
            </Box>
          ))}
          <Box>
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              disabled={disabled}
              onClick={() =>
                update([
                  ...templates,
                  { name: "", kind: "linux", image: "", setDefault: false },
                ])
              }
            >
              Add template
            </Button>
          </Box>
        </Stack>
      )}
      {rowError && (
        <Typography color="error" variant="caption" role="alert">
          {rowError}
        </Typography>
      )}
    </Stack>
  );
}
