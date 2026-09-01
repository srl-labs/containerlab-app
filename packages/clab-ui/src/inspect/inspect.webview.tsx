import { IconRefresh, IconSearch } from "@tabler/icons-react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton
} from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";

import { ClabUiRuntimeProvider, type ClabUiRuntime } from "../host";
import { AppThemeProvider } from "../theme/index";
import { usePostMessage } from "./shared/hooks";

import type { ContainerPort, InspectContainerData, InspectWebviewInitialData } from "./types";

type InspectOutgoingMessage =
  | { command: "refresh" }
  | {
      command: "openPort";
      containerName: string;
      containerId: string;
      port: string | number;
      protocol: string;
    };

interface InspectRow {
  containerName: string;
  kind: string;
  type: string;
  image: string;
  state: string;
  status: string;
  pid: string;
  ipv4: string;
  ipv6: string;
  network: string;
  owner: string;
  ports: ContainerPort[];
  containerId: string;
  searchText: string;
}

interface InspectGroup {
  labName: string;
  rows: InspectRow[];
}

type ColumnId =
  | "containerName"
  | "kind"
  | "type"
  | "image"
  | "state"
  | "status"
  | "pid"
  | "ipv4"
  | "ipv6"
  | "network"
  | "owner"
  | "ports";

interface ColumnDefinition {
  id: ColumnId;
  label: string;
  value: (row: InspectRow) => string;
  style?: React.CSSProperties;
}

interface SortState {
  columnId: ColumnId;
  direction: "asc" | "desc";
}

interface InspectGroupPanelProps {
  readonly group: InspectGroup;
  readonly activeSort?: SortState;
  readonly onToggleSort: (labName: string, columnId: ColumnId) => void;
  readonly onOpenPort: (payload: {
    containerName: string;
    containerId: string;
    port: string | number;
    protocol: string;
  }) => void;
}

const COLUMNS: ReadonlyArray<ColumnDefinition> = [
  { id: "containerName", label: "Name", value: (row) => row.containerName },
  { id: "kind", label: "Kind", value: (row) => row.kind },
  { id: "type", label: "Type", value: (row) => row.type },
  {
    id: "image",
    label: "Image",
    value: (row) => row.image,
    style: { minWidth: 180, maxWidth: 240 }
  },
  { id: "state", label: "State", value: (row) => row.state },
  { id: "status", label: "Status", value: (row) => row.status },
  { id: "pid", label: "PID", value: (row) => row.pid },
  { id: "ipv4", label: "IPv4", value: (row) => row.ipv4 },
  { id: "ipv6", label: "IPv6", value: (row) => row.ipv6 },
  { id: "network", label: "Network", value: (row) => row.network },
  { id: "owner", label: "Owner", value: (row) => row.owner },
  {
    id: "ports",
    label: "Ports",
    value: (row) => row.ports.map((port) => `${port.port}/${port.protocol}`).join(", ")
  }
];

function firstTruthyString(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    if (value && value.length > 0) {
      return value;
    }
  }
  return "";
}

function getLabName(container: InspectContainerData): string {
  const labelFromPath = container.Labels?.["clab-topo-file"]
    ?.split("/")
    .slice(-1)[0]
    ?.replace(".clab.yml", "");

  return (
    container.lab_name ||
    container.labPath ||
    container.Labels?.containerlab ||
    labelFromPath ||
    "unknown-lab"
  );
}

function buildInspectRow(container: InspectContainerData): InspectRow {
  const containerName = firstTruthyString(
    container.name,
    Array.isArray(container.Names) ? container.Names[0] : "",
    container.Labels?.["clab-node-longname"]
  );

  const kind = firstTruthyString(container.kind, container.Labels?.["clab-node-kind"]);
  const type = firstTruthyString(container.node_type, container.Labels?.["clab-node-type"]);
  const image = firstTruthyString(container.image, container.Image);
  const state = firstTruthyString(container.state, container.State);
  const status = firstTruthyString(container.status, container.Status);
  const pid = typeof container.Pid === "number" ? String(container.Pid) : "";
  const network = firstTruthyString(container.network_name, container.NetworkName);
  const owner = container.Labels?.["clab-owner"] || "";

  const ipv4 = firstTruthyString(
    container.ipv4_address,
    container.NetworkSettings?.IPv4addr,
    container.NetworkSettings?.ipv4_address
  );

  const ipv6 = firstTruthyString(
    container.ipv6_address,
    container.NetworkSettings?.IPv6addr,
    container.NetworkSettings?.ipv6_address
  );

  const containerId = firstTruthyString(
    container.ID,
    container.id,
    container.ShortID,
    container.container_id
  );
  const ports = Array.isArray(container.Ports) ? container.Ports : [];

  const searchText = [
    containerName,
    kind,
    type,
    image,
    state,
    status,
    pid,
    ipv4,
    ipv6,
    network,
    owner,
    ports.map((port) => `${port.port}/${port.protocol}`).join(" ")
  ]
    .join(" ")
    .toLowerCase();

  return {
    containerName,
    kind,
    type,
    image,
    state,
    status,
    pid,
    ipv4,
    ipv6,
    network,
    owner,
    ports,
    containerId,
    searchText
  };
}

function buildGroups(containers: InspectContainerData[]): InspectGroup[] {
  const grouped = new Map<string, InspectRow[]>();

  for (const container of containers) {
    const labName = getLabName(container);
    const rows = grouped.get(labName) ?? [];
    rows.push(buildInspectRow(container));
    grouped.set(labName, rows);
  }

  return [...grouped.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([labName, rows]) => ({ labName, rows }));
}

function parseNumericValue(value: string): number | null {
  const normalized = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isNaN(parsed) ? null : parsed;
}

function sortRows(rows: InspectRow[], sortState: SortState | undefined): InspectRow[] {
  if (!sortState) {
    return rows;
  }

  const column = COLUMNS.find((candidate) => candidate.id === sortState.columnId);
  if (!column) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    const leftText = column.value(left).trim();
    const rightText = column.value(right).trim();

    const leftNumeric = parseNumericValue(leftText);
    const rightNumeric = parseNumericValue(rightText);

    let result = 0;
    if (leftNumeric !== null && rightNumeric !== null) {
      result = leftNumeric - rightNumeric;
    } else {
      result = leftText.localeCompare(rightText, undefined, { sensitivity: "base" });
    }

    return sortState.direction === "asc" ? result : -result;
  });
}

function createFilter(query: string): (value: string) => boolean {
  const normalized = query.trim();
  if (!normalized) {
    return () => true;
  }

  try {
    const looksLikeRegex =
      normalized.includes("\\") ||
      normalized.includes("[") ||
      normalized.includes("(") ||
      normalized.includes("|") ||
      normalized.includes("^") ||
      normalized.includes("$") ||
      normalized.includes(".*") ||
      normalized.includes(".+");

    let processedPattern = normalized;
    if (!looksLikeRegex) {
      const hasWildcards = /[*?#]/.test(normalized);
      processedPattern = normalized
        .replaceAll("*", ".*")
        .replaceAll("?", ".")
        .replaceAll("#", "\\d+");
      if (hasWildcards) {
        processedPattern = `^${processedPattern}$`;
      }
    }

    const regex = new RegExp(processedPattern, "i");
    return (value: string) => regex.test(value);
  } catch {
    const queryLower = normalized.toLowerCase();
    return (value: string) => value.toLowerCase().includes(queryLower);
  }
}

function stateToColorToken(state: string): string {
  const normalized = state.trim().toLowerCase();
  switch (normalized) {
    case "running":
      return "green";
    case "exited":
    case "stopped":
      return "red";
    default:
      return "yellow";
  }
}

interface PortsCellProps {
  readonly row: InspectRow;
  readonly onOpenPort: InspectGroupPanelProps["onOpenPort"];
}

function PortsCell({ row, onOpenPort }: Readonly<PortsCellProps>): React.JSX.Element {
  if (row.ports.length === 0) {
    return <>-</>;
  }

  return (
    <Group gap={4}>
      {row.ports.map((port) => {
        const key = `${row.containerId}-${port.port}-${port.protocol}`;
        return (
          <Badge
            key={key}
            size="sm"
            variant="outline"
            style={{ cursor: "pointer" }}
            onClick={() => {
              onOpenPort({
                containerName: row.containerName,
                containerId: row.containerId,
                port: port.port,
                protocol: port.protocol
              });
            }}
          >
            {`${port.port}/${port.protocol}`}
          </Badge>
        );
      })}
    </Group>
  );
}

function InspectGroupPanel({
  group,
  activeSort,
  onToggleSort,
  onOpenPort
}: Readonly<InspectGroupPanelProps>): React.JSX.Element {
  return (
    <Paper withBorder style={{ overflow: "hidden" }}>
      <div
        style={{
          paddingInline: 12,
          paddingBlock: 8,
          borderBottom: "1px solid var(--mantine-color-default-border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexWrap: "wrap"
        }}
      >
        <Text size="sm" fw={600}>
          {group.labName}
        </Text>
        <Badge size="sm" variant="outline">{`${group.rows.length} containers`}</Badge>
      </div>

      <Table.ScrollContainer minWidth={480} maxHeight={420}>
        <Table stickyHeader aria-label={`Inspect table for ${group.labName}`}>
          <Table.Thead>
            <Table.Tr>
              {COLUMNS.map((column) => {
                const isActive = activeSort?.columnId === column.id;
                const direction = isActive ? activeSort.direction : "asc";
                return (
                  <Table.Th key={column.id} style={{ whiteSpace: "nowrap", ...column.style }}>
                    <UnstyledButton
                      onClick={() => {
                        onToggleSort(group.labName, column.id);
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        font: "inherit",
                        color: "inherit"
                      }}
                    >
                      {column.label}
                      <span style={{ opacity: isActive ? 1 : 0, fontSize: "0.75em" }}>
                        {direction === "asc" ? "\u25B2" : "\u25BC"}
                      </span>
                    </UnstyledButton>
                  </Table.Th>
                );
              })}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {group.rows.map((row) => {
              const stateColor = stateToColorToken(row.state);
              return (
                <Table.Tr
                  key={`${group.labName}-${row.containerId || row.containerName}-${row.network}`}
                >
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{row.containerName || "-"}</Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{row.kind || "-"}</Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{row.type || "-"}</Table.Td>
                  <Table.Td style={{ minWidth: 180, maxWidth: 240 }} title={row.image || ""}>
                    <Text
                      size="sm"
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {row.image || "-"}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    <Badge
                      size="sm"
                      variant="outline"
                      color={stateColor}
                      style={{ fontWeight: 600 }}
                    >
                      {row.state || "-"}
                    </Badge>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{row.status || "-"}</Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{row.pid || "-"}</Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{row.ipv4 || "-"}</Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{row.ipv6 || "-"}</Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{row.network || "-"}</Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>{row.owner || "-"}</Table.Td>
                  <Table.Td>
                    <PortsCell row={row} onOpenPort={onOpenPort} />
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  );
}

export function InspectApp(): React.JSX.Element {
  const initialData = (window.__INITIAL_DATA__ ?? {}) as unknown as InspectWebviewInitialData;
  const containers = Array.isArray(initialData.containers) ? initialData.containers : [];

  const postMessage = usePostMessage<InspectOutgoingMessage>();

  const [searchText, setSearchText] = React.useState("");
  const [sortByLab, setSortByLab] = React.useState<Record<string, SortState | undefined>>({});

  const groupedRows = React.useMemo(() => buildGroups(containers), [containers]);
  const filter = React.useMemo(() => createFilter(searchText), [searchText]);

  const filteredGroups = React.useMemo(() => {
    const hasSearch = searchText.trim().length > 0;

    return groupedRows
      .map((group) => {
        if (!hasSearch) {
          return {
            labName: group.labName,
            rows: sortRows(group.rows, sortByLab[group.labName])
          };
        }

        const labMatches = filter(group.labName);
        const matchingRows = labMatches
          ? group.rows
          : group.rows.filter((row) => filter(row.containerName) || filter(row.searchText));

        if (matchingRows.length === 0) {
          return undefined;
        }

        return {
          labName: group.labName,
          rows: sortRows(matchingRows, sortByLab[group.labName])
        };
      })
      .filter((group): group is InspectGroup => Boolean(group));
  }, [filter, groupedRows, searchText, sortByLab]);

  const hasData = filteredGroups.length > 0;

  const handleToggleSort = React.useCallback((labName: string, columnId: ColumnId) => {
    setSortByLab((current) => {
      const currentSort = current[labName];
      const nextDirection =
        currentSort?.columnId === columnId && currentSort.direction === "asc" ? "desc" : "asc";

      return {
        ...current,
        [labName]: {
          columnId,
          direction: nextDirection
        }
      };
    });
  }, []);

  const handleOpenPort = React.useCallback(
    (payload: {
      containerName: string;
      containerId: string;
      port: string | number;
      protocol: string;
    }) => {
      postMessage({
        command: "openPort",
        containerName: payload.containerName,
        containerId: payload.containerId,
        port: payload.port,
        protocol: payload.protocol
      });
    },
    [postMessage]
  );

  return (
    <AppThemeProvider>
      <div
        style={{
          width: "100%",
          height: "100%",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          overflow: "hidden",
          backgroundColor: "var(--mantine-color-body)"
        }}
      >
        <Paper
          withBorder
          style={{
            padding: 12,
            display: "flex",
            gap: 12,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap"
          }}
        >
          <Title order={5} style={{ lineHeight: 1.2 }}>
            Containerlab Inspect
          </Title>

          <Group gap="xs" align="center" style={{ minWidth: 260 }}>
            <TextInput
              style={{ flex: 1 }}
              value={searchText}
              onChange={(event) => {
                setSearchText(event.currentTarget.value);
              }}
              placeholder="Search labs or nodes"
              leftSection={<IconSearch size={18} />}
            />
            <Button
              variant="outline"
              leftSection={<IconRefresh size={18} />}
              onClick={() => {
                postMessage({ command: "refresh" });
              }}
            >
              Refresh
            </Button>
          </Group>
        </Paper>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingRight: 4 }}>
          {!hasData ? (
            <Alert color="blue" variant="outline">
              No containers found.
            </Alert>
          ) : null}

          <Stack gap="md">
            {filteredGroups.map((group) => (
              <InspectGroupPanel
                key={group.labName}
                group={group}
                activeSort={sortByLab[group.labName]}
                onToggleSort={handleToggleSort}
                onOpenPort={handleOpenPort}
              />
            ))}
          </Stack>
        </div>
      </div>
    </AppThemeProvider>
  );
}

export function bootstrapInspectWebview(runtime: ClabUiRuntime): void {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Inspect webview root element not found");
  }

  const root = createRoot(container);
  root.render(
    <ClabUiRuntimeProvider runtime={runtime}>
      <React.StrictMode>
        <InspectApp />
      </React.StrictMode>
    </ClabUiRuntimeProvider>
  );
}
