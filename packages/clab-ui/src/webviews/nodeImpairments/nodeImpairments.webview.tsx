import { Alert, Button, Group, Paper, Table, Text, TextInput, Title } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";

import { ClabUiRuntimeProvider, type ClabUiRuntime } from "../../host";
import { AppThemeProvider } from "@srl-labs/clab-ui/theme";
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
    <AppThemeProvider>
      <div
        style={{
          width: "100%",
          height: "100%",
          padding: 16,
          backgroundColor: "var(--mantine-color-body)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        }}
      >
        <Paper
          withBorder
          style={{
            padding: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexWrap: "wrap"
          }}
        >
          <Title order={5} style={{ lineHeight: 1.2 }}>
            Link Impairments: {nodeName}
          </Title>

          <Group gap="xs">
            <Button
              onClick={() => {
                postMessage({ command: "apply", data: netemByInterface });
              }}
            >
              Apply
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                postMessage({ command: "clearAll" });
              }}
            >
              Clear All
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                postMessage({ command: "refresh" });
              }}
            >
              Refresh
            </Button>
          </Group>
        </Paper>

        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", marginTop: 16 }}>
          {sortedInterfaces.length === 0 ? (
            <Alert color="blue" variant="outline">
              No interfaces available for this node.
            </Alert>
          ) : (
            <Table.ScrollContainer
              minWidth={480}
              maxHeight="100%"
              style={{
                border: "1px solid var(--mantine-color-default-border)",
                borderRadius: "var(--mantine-radius-default)"
              }}
            >
              <Table
                stickyHeader
                aria-label={`Link impairments table for ${nodeName}`}
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th style={{ whiteSpace: "nowrap" }}>Interface</Table.Th>
                    {FIELD_META.map((field) => (
                      <Table.Th key={field.key} style={{ whiteSpace: "nowrap" }}>
                        {field.label}
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {sortedInterfaces.map((iface) => {
                    const fields = netemByInterface[iface];
                    const hasValidationError = hasDelayValidationError(fields);

                    return (
                      <Table.Tr key={iface}>
                        <Table.Td style={{ whiteSpace: "nowrap", fontWeight: 500 }}>
                          {iface}
                        </Table.Td>
                        {FIELD_META.map((field) => {
                          const showDelayMessage = field.key === "delay" && hasValidationError;
                          const isErrorField =
                            hasValidationError && (field.key === "delay" || field.key === "jitter");

                          return (
                            <Table.Td key={`${iface}-${field.key}`} style={{ minWidth: 148 }}>
                              <TextInput
                                type={field.inputType}
                                value={fields[field.key]}
                                placeholder={field.placeholder}
                                error={
                                  showDelayMessage
                                    ? "A positive delay is required if jitter is set."
                                    : isErrorField
                                }
                                onChange={(event) => {
                                  updateField(iface, field.key, event.currentTarget.value);
                                }}
                                rightSection={
                                  <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                                    {field.unit}
                                  </Text>
                                }
                                rightSectionWidth={64}
                              />
                            </Table.Td>
                          );
                        })}
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </div>
      </div>
    </AppThemeProvider>
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
