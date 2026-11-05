/** A table as the engine renders it: filtered, sorted and capped, so a big route table stays quick. */
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import SearchIcon from "@mui/icons-material/Search";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import React, { useDeferredValue, useMemo, useState } from "react";

import { controlRadius } from "../../theme/surfaces";

import { useFabric } from "./fabricContext";
import { ribFormQuery } from "./fabricReports";
import { nodeRoute, reportRoute } from "./fabricRoute";
import {
  cellPlain,
  columnLines,
  filterRows,
  isRxActTx,
  isStateColumn,
  sortRows,
  stateTone,
  type FabricRxActTx,
  type FabricTableSort
} from "./fabricTable";
import type { FabricCell } from "./fabricTypes";
import { EmptyState, MONO_SX, Pill, TABLE_SX, TextLink } from "./fabricUi";

const PAGE = 300;

const FILTER_HELP = (
  <Box sx={{ fontSize: 12, lineHeight: 1.6 }}>
    <div><b>up</b> the cell contains it</div>
    <div><b>!fe80</b> does not contain it</div>
    <div><b>=up</b> is exactly it</div>
    <div><b>&gt;10</b> or <b>&lt;=5</b> compares numbers</div>
    <div><b>=a|=b</b> either one</div>
  </Box>
);

function RxActTxCell({ count }: { count: FabricRxActTx }): React.JSX.Element {
  const { go } = useFabric();
  const link = (which: "rx" | "act" | "tx", value: number, name: string) => {
    const { report, query } = ribFormQuery(count, which);
    return (
      <TextLink title={`${value} ${name}: open the BGP RIB form`} onClick={() => go(reportRoute(report, query))}>{value}</TextLink>
    );
  };
  return (
    <Box component="span" sx={{ whiteSpace: "nowrap" }}>
      {link("rx", count.rx, "received")}
      <Box component="span" sx={{ color: "text.disabled" }}> / </Box>
      {link("act", count.act, "active")}
      <Box component="span" sx={{ color: "text.disabled" }}> / </Box>
      {link("tx", count.tx, "advertised")}
    </Box>
  );
}

function Cell({ cell, column, isNode }: { cell: FabricCell; column: string; isNode: boolean }): React.JSX.Element {
  const { go } = useFabric();
  if (isRxActTx(cell)) return <RxActTxCell count={cell} />;
  const text = cellPlain(cell);
  if (isNode && text) return <TextLink onClick={() => go(nodeRoute(text))}>{text}</TextLink>;
  if (isStateColumn(column) && text) {
    const tone = stateTone(cell);
    if (tone) return <Pill dot tone={tone === "good" ? "good" : "bad"}>{text}</Pill>;
  }
  // Each flag has its place: `--F` must not read as a dash and an F.
  const sx = column === "flags" ? { whiteSpace: "pre", ...MONO_SX } : { whiteSpace: "pre" };
  return <Box component="span" sx={sx}>{text}</Box>;
}

function ColumnHead({ column, sort, index, onSort }: {
  column: string;
  sort: FabricTableSort | undefined;
  index: number;
  onSort: (index: number) => void;
}): React.JSX.Element {
  const sorted = sort?.column === index;
  const [first, second] = columnLines(column);
  return (
    <Box
      component="button"
      type="button"
      onClick={() => onSort(index)}
      sx={{
        all: "unset", display: "inline-flex", alignItems: "flex-end", gap: 0.25, cursor: "pointer",
        "&:hover": { color: "text.primary" },
        "&:focus-visible": { outline: "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))" }
      }}
    >
      <span>
        {first}
        {second ? <Box component="span" sx={{ display: "block", fontWeight: 400 }}>{second}</Box> : null}
      </span>
      {sorted && sort.descending ? <ArrowDownwardIcon sx={{ fontSize: 13 }} /> : null}
      {sorted && !sort.descending ? <ArrowUpwardIcon sx={{ fontSize: 13 }} /> : null}
    </Box>
  );
}

function ariaSort(sort: FabricTableSort | undefined, column: number): "ascending" | "descending" | undefined {
  if (sort?.column !== column) return undefined;
  return sort.descending ? "descending" : "ascending";
}

function ColumnFilter({ column, value, onChange }: { column: string; value: string; onChange: (value: string) => void }): React.JSX.Element {
  return (
    <Box
      component="input"
      value={value}
      placeholder="Filter"
      aria-label={`Filter ${columnLines(column).join(" ")}`}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      sx={{
        width: "100%", minWidth: 44, boxSizing: "border-box", height: 22, px: 0.5, font: "inherit", fontWeight: 400, color: "text.primary",
        bgcolor: "transparent", borderRadius: controlRadius, outline: "none",
        border: `1px solid ${value ? "var(--clab-ui-focus-border, var(--vscode-focusBorder))" : "transparent"}`,
        "&::placeholder": { color: "text.disabled", opacity: 1 },
        "&:hover": { borderColor: "divider" },
        "&:focus": { borderColor: "var(--clab-ui-focus-border, var(--vscode-focusBorder))" }
      }}
    />
  );
}

export function FabricDataTable({ columns, rows, initialFilters, keepOrder = false, emptyLabel = "No rows.", onFiltersChange, rowAction, testId }: {
  columns: readonly string[];
  rows: readonly FabricCell[][];
  /** Filters a link came with, by column name. */
  initialFilters?: Readonly<Record<string, string>>;
  /** Rows that mean something in their order, like the hops of a path. */
  keepOrder?: boolean;
  emptyLabel?: string;
  onFiltersChange?: (filters: Record<string, string>) => void;
  /** A last column of something to do with a row. */
  rowAction?: (row: FabricCell[]) => React.ReactNode;
  testId?: string;
}): React.JSX.Element {
  const [text, setText] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>(() => ({ ...initialFilters }));
  const [sort, setSort] = useState<FabricTableSort>();
  const [shown, setShown] = useState(PAGE);
  const filters = useDeferredValue(useMemo(() => ({ text, columns: columnFilters }), [text, columnFilters]));
  const filtered = useMemo(() => filterRows(columns, rows, filters), [columns, rows, filters]);
  const sorted = useMemo(() => (keepOrder && !sort ? filtered : sortRows(filtered, sort)), [filtered, sort, keepOrder]);
  const visible = sorted.slice(0, shown);
  const filtering = text.trim() !== "" || Object.values(columnFilters).some((value) => value.trim() !== "");

  const onSort = (index: number) => {
    setSort((current) => {
      if (current?.column !== index) return { column: index, descending: false };
      return current.descending ? undefined : { column: index, descending: true };
    });
  };
  const setColumnFilter = (column: string, value: string) => {
    const next = { ...columnFilters, [column]: value };
    setColumnFilters(next);
    setShown(PAGE);
    onFiltersChange?.(next);
  };
  const clear = () => {
    setText("");
    setColumnFilters({});
    onFiltersChange?.({});
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} data-testid={testId}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, pb: 1, flexWrap: "wrap", flexShrink: 0 }}>
        <TextField
          size="small"
          placeholder="Filter rows"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setShown(PAGE);
          }}
          slotProps={{
            htmlInput: { "aria-label": "Filter rows", "data-testid": "fabric-table-filter" },
            input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }
          }}
          sx={{ width: 220 }}
        />
        <Tooltip title={FILTER_HELP}>
          <HelpOutlineIcon fontSize="small" aria-label="How filters work" sx={{ color: "text.disabled" }} />
        </Tooltip>
        <Typography variant="caption" data-testid="fabric-table-count" sx={{ color: "text.secondary" }}>
          {filtering ? `${sorted.length} of ${rows.length} rows` : `${rows.length} ${rows.length === 1 ? "row" : "rows"}`}
        </Typography>
        {filtering ? <Button size="small" variant="text" onClick={clear}>Clear filters</Button> : null}
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", borderTop: 1, borderColor: "divider" }}>
        <Box component="table" sx={TABLE_SX} data-testid="fabric-table">
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={column} aria-sort={ariaSort(sort, index)}>
                  <ColumnHead column={column} index={index} sort={sort} onSort={onSort} />
                </th>
              ))}
              {rowAction ? <th /> : null}
            </tr>
            <tr>
              {columns.map((column) => (
                <th key={column} style={{ paddingTop: 2, paddingBottom: 2 }}>
                  <ColumnFilter column={column} value={columnFilters[column] ?? ""} onChange={(value) => setColumnFilter(column, value)} />
                </th>
              ))}
              {rowAction ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, rowIndex) => (
              // The engine's rows have no key of their own, and a live update replaces them whole.
              <tr key={rowIndex}>
                {columns.map((column, index) => (
                  <td key={column}>
                    <Cell cell={row[index]} column={column} isNode={column === "Node"} />
                  </td>
                ))}
                {rowAction ? <td>{rowAction(row)}</td> : null}
              </tr>
            ))}
          </tbody>
        </Box>
        {sorted.length === 0 ? <EmptyState title={filtering ? "No row matches the filters" : emptyLabel} /> : null}
        {sorted.length > shown ? (
          <Box sx={{ p: 1, display: "flex", justifyContent: "center" }}>
            <Button size="small" variant="outlined" data-testid="fabric-table-more" onClick={() => setShown(shown + PAGE)}>
              Show more ({sorted.length - shown} left)
            </Button>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}
