/* eslint-disable import-x/max-dependencies */
import SettingsEthernetIcon from "@mui/icons-material/SettingsEthernet";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputAdornment from "@mui/material/InputAdornment";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import React from "react";
import { createRoot } from "react-dom/client";

import { ClabUiRuntimeProvider, type ClabUiRuntime } from "../../host";
import { MuiThemeProvider } from "../../theme/index";
import { controlRadius } from "../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../theme/typography";
import { useMessageListener, usePostMessage } from "../shared/hooks";

import type { NetemDataMap, NetemFields, NodeImpairmentsInitialData } from "./types";

type NodeImpairmentsOutgoingMessage =
  | { command: "apply"; data: NetemDataMap }
  | { command: "clearAll" }
  | { command: "refresh" };

interface NodeImpairmentsUpdateMessage {
  command: "updateFields";
  data?: Record<string, Partial<NetemFields>>;
}

type NodeImpairmentsIncomingMessage = NodeImpairmentsUpdateMessage;

const FIELD_META: ReadonlyArray<{
  key: keyof NetemFields;
  label: string;
  unit: string;
  placeholder: string;
  inputType: "text" | "number";
}> = [
  { key: "delay", label: "Delay", unit: "ms/s/m", placeholder: "50", inputType: "text" },
  { key: "jitter", label: "Jitter", unit: "ms/s", placeholder: "10", inputType: "text" },
  { key: "loss", label: "Loss", unit: "%", placeholder: "0", inputType: "text" },
  { key: "rate", label: "Rate-limit", unit: "kb/s", placeholder: "1000", inputType: "number" },
  {
    key: "corruption",
    label: "Corruption",
    unit: "%",
    placeholder: "0",
    inputType: "text"
  }
];

function normalizeNetemFields(fields?: Partial<NetemFields>): NetemFields {
  return {
    delay: fields?.delay ?? "",
    jitter: fields?.jitter ?? "",
    loss: fields?.loss ?? "",
    rate: fields?.rate ?? "",
    corruption: fields?.corruption ?? ""
  };
}

function normalizeNetemMap(data?: Record<string, Partial<NetemFields>>): NetemDataMap {
  const normalized: NetemDataMap = {};
  for (const [iface, fields] of Object.entries(data ?? {})) {
    normalized[iface] = normalizeNetemFields(fields);
  }
  return normalized;
}

function hasDelayValidationError(fields: NetemFields): boolean {
  const jitter = Number.parseFloat(fields.jitter) || 0;
  const delay = Number.parseFloat(fields.delay) || 0;
  return jitter > 0 && delay <= 0;
}

export function NodeImpairmentsApp(): React.JSX.Element {
  const initialData = (window.__INITIAL_DATA__ ?? {}) as unknown as NodeImpairmentsInitialData;
  const nodeName = initialData.nodeName ?? "";

  const postMessage = usePostMessage<NodeImpairmentsOutgoingMessage>();

  const [netemByInterface, setNetemByInterface] = React.useState<NetemDataMap>(() =>
    normalizeNetemMap(initialData.interfacesData)
  );

  const sortedInterfaces = React.useMemo(
    () => Object.keys(netemByInterface).sort((left, right) => left.localeCompare(right)),
    [netemByInterface]
  );

  useMessageListener<NodeImpairmentsIncomingMessage>((message) => {
    if (message.command !== "updateFields") {
      return;
    }

    setNetemByInterface(normalizeNetemMap(message.data));
  });

  const updateField = React.useCallback(
    (iface: string, field: keyof NetemFields, nextValue: string) => {
      setNetemByInterface((current) => {
        const currentFields = current[iface] ?? normalizeNetemFields();
        return {
          ...current,
          [iface]: {
            ...currentFields,
            [field]: nextValue
          }
        };
      });
    },
    []
  );

  return (
    <MuiThemeProvider>
      <Box
        sx={{
          width: "100%",
          height: "100%",
          bgcolor: "background.default",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        }}
      >
        <Box
          sx={{
            px: 2,
            py: 1.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1.5,
            flexWrap: "wrap",
            borderBottom: 1,
            borderColor: "divider"
          }}
        >
          <Typography variant="h6" sx={{ minWidth: 0 }}>
            Link Impairments:{" "}
            <Box component="span" sx={{ fontFamily: MONO_FONT_FAMILY, fontWeight: 500 }}>
              {nodeName}
            </Box>
          </Typography>

          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              onClick={() => {
                postMessage({ command: "apply", data: netemByInterface });
              }}
            >
              Apply
            </Button>
            <Button
              variant="outlined"
              onClick={() => {
                postMessage({ command: "clearAll" });
              }}
            >
              Clear All
            </Button>
            <Button
              variant="outlined"
              onClick={() => {
                postMessage({ command: "refresh" });
              }}
            >
              Refresh
            </Button>
          </Stack>
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", p: 2 }}>
          {sortedInterfaces.length === 0 ? (
            <Stack spacing={1.5} sx={{ alignItems: "center", py: 8, color: "text.secondary" }}>
              <SettingsEthernetIcon sx={{ fontSize: 28, opacity: 0.8 }} />
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                No interfaces available for this node.
              </Typography>
            </Stack>
          ) : (
            <TableContainer
              sx={{
                maxHeight: "100%",
                border: 1,
                borderColor: "divider",
                borderRadius: controlRadius,
                "& thead th": { bgcolor: "background.paper" },
                "& tbody tr:last-of-type > td": { borderBottom: 0 }
              }}
            >
              <Table
                stickyHeader
                size="small"
                aria-label={`Link impairments table for ${nodeName}`}
              >
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>Interface</TableCell>
                    {FIELD_META.map((field) => (
                      <TableCell key={field.key} sx={{ whiteSpace: "nowrap" }}>
                        {field.label}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedInterfaces.map((iface) => {
                    const fields = netemByInterface[iface];
                    const hasValidationError = hasDelayValidationError(fields);

                    return (
                      <TableRow key={iface} hover>
                        <TableCell
                          sx={{
                            whiteSpace: "nowrap",
                            fontFamily: MONO_FONT_FAMILY,
                            fontSize: 12,
                            verticalAlign: "top",
                            lineHeight: "32px"
                          }}
                        >
                          {iface}
                        </TableCell>
                        {FIELD_META.map((field) => {
                          const showDelayMessage = field.key === "delay" && hasValidationError;
                          const isErrorField =
                            hasValidationError && (field.key === "delay" || field.key === "jitter");

                          return (
                            <TableCell
                              key={`${iface}-${field.key}`}
                              sx={{ minWidth: 148, verticalAlign: "top" }}
                            >
                              <TextField
                                fullWidth
                                type={field.inputType}
                                value={fields[field.key]}
                                placeholder={field.placeholder}
                                error={isErrorField}
                                helperText={
                                  showDelayMessage
                                    ? "A positive delay is required if jitter is set."
                                    : undefined
                                }
                                onChange={(event) => {
                                  updateField(iface, field.key, event.target.value);
                                }}
                                slotProps={{
                                  input: {
                                    endAdornment: (
                                      <InputAdornment
                                        position="end"
                                        sx={{ "& .MuiTypography-root": { fontSize: 12 } }}
                                      >
                                        {field.unit}
                                      </InputAdornment>
                                    )
                                  }
                                }}
                              />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Box>
      </Box>
    </MuiThemeProvider>
  );
}

export function bootstrapNodeImpairmentsWebview(runtime: ClabUiRuntime): void {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Node impairments root element not found");
  }

  const root = createRoot(container);
  root.render(
    <ClabUiRuntimeProvider runtime={runtime}>
      <React.StrictMode>
        <NodeImpairmentsApp />
      </React.StrictMode>
    </ClabUiRuntimeProvider>
  );
}
