import React from "react";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import SearchOffIcon from "@mui/icons-material/SearchOff";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { controlRadius } from "../../theme/surfaces";
import { formatSize, isUnbuildable, recordFolder, recordName, recordVendor } from "./imagesModel";
import { EmptyMessage, MONO_SX, StatusLabel, recordStatusHint, recordStatusLabel, recordTone } from "./imagesUi";
import type { ImageRecord, ImagesIndexInfo, ImagesRecordStatus, ImagesSource } from "./types";

export interface SearchFilters {
  q: string;
  kind: string;
  vendor: string;
  source: ImagesSource;
  status: "" | ImagesRecordStatus;
  /** Also list entries without a buildable kind (`--all`). */
  includeUnbuildable: boolean;
}

export const NO_FILTERS: SearchFilters = { q: "", kind: "", vendor: "", source: "all", status: "", includeUnbuildable: true };

const filtersActive = (filters: SearchFilters): boolean =>
  filters.q.trim() !== "" || filters.kind !== "" || filters.vendor !== "" || filters.source !== "all" || filters.status !== "" ||
  !filters.includeUnbuildable;

const SOURCE_LABELS: Record<ImagesSource, string> = { all: "All", labhub: "LabHub", local: "Local files" };
const STATUSES: ImagesRecordStatus[] = ["built", "cached", "available"];

function FilterSelect({ label, value, options, testId, onChange }: {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  testId: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      data-testid={testId}
      onChange={(event) => onChange(event.target.value)}
      sx={{ minWidth: 128 }}
      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
    >
      {options.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
    </TextField>
  );
}

/** Keyword search over LabHub and the local images folders, with the index age and a refresh. */
export function SearchBar({ filters, kinds, vendors, index, indexBusy, onChange, onRefreshIndex }: {
  filters: SearchFilters;
  kinds: string[];
  vendors: string[];
  index?: ImagesIndexInfo;
  indexBusy: boolean;
  onChange: (filters: SearchFilters) => void;
  onRefreshIndex: () => void;
}): React.JSX.Element {
  const all = { value: "", label: "All" };
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", px: 2, pt: 1.5, pb: 1, flexShrink: 0 }}>
      <TextField
        size="small"
        placeholder="Search images, kinds, versions"
        value={filters.q}
        onChange={(event) => onChange({ ...filters, q: event.target.value })}
        slotProps={{
          htmlInput: { "aria-label": "Search images", "data-testid": "images-search-input" },
          input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }
        }}
        sx={{ width: 260 }}
      />
      <FilterSelect
        label="Source"
        value={filters.source}
        testId="images-filter-source"
        options={(Object.keys(SOURCE_LABELS) as ImagesSource[]).map((value) => ({ value, label: SOURCE_LABELS[value] }))}
        onChange={(source) => onChange({ ...filters, source: source as ImagesSource })}
      />
      <FilterSelect
        label="Status"
        value={filters.status}
        testId="images-filter-status"
        options={[all, ...STATUSES.map((value) => ({ value, label: value }))]}
        onChange={(status) => onChange({ ...filters, status: status as SearchFilters["status"] })}
      />
      <FilterSelect
        label="Kind"
        value={filters.kind}
        testId="images-filter-kind"
        options={[all, ...kinds.map((value) => ({ value, label: value }))]}
        onChange={(kind) => onChange({ ...filters, kind })}
      />
      <FilterSelect
        label="Vendor"
        value={filters.vendor}
        testId="images-filter-vendor"
        options={[all, ...vendors.map((value) => ({ value, label: value }))]}
        onChange={(vendor) => onChange({ ...filters, vendor })}
      />
      <FormControlLabel
        label="Include not buildable"
        control={
          <Switch
            size="small"
            checked={filters.includeUnbuildable}
            onChange={(event) => onChange({ ...filters, includeUnbuildable: event.target.checked })}
            slotProps={{ input: { "aria-label": "Include not buildable", "data-testid": "images-include-unbuildable" } as React.InputHTMLAttributes<HTMLInputElement> }}
          />
        }
        slotProps={{ typography: { variant: "body2", noWrap: true } }}
        sx={{ mx: 0.5 }}
      />
      {filtersActive(filters) ? <Button size="small" variant="text" onClick={() => onChange(NO_FILTERS)}>Clear</Button> : null}
      <Box sx={{ flex: 1 }} />
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
        <Typography variant="caption" data-testid="images-index-age" sx={{ color: "text.secondary" }} noWrap>
          {index ? `LabHub ${index.release ?? "index"} · ${index.age ? `updated ${index.age} ago` : "age unknown"}` : "LabHub index…"}
        </Typography>
        <Tooltip title="Fetch the LabHub index again">
          <span>
            <IconButton size="small" aria-label="Refresh the LabHub index" data-testid="images-index-refresh" disabled={indexBusy} onClick={onRefreshIndex}>
              {indexBusy ? <CircularProgress size={14} /> : <RefreshIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}

function ResultRow({ record, selected, onSelect }: { record: ImageRecord; selected: boolean; onSelect: (record: ImageRecord) => void }) {
  const name = recordName(record);
  const vendor = recordVendor(record);
  const folder = recordFolder(record);
  const unbuildable = isUnbuildable(record);
  return (
    <TableRow
      hover
      selected={selected}
      tabIndex={0}
      aria-selected={selected}
      data-testid="images-result-row"
      data-key={record.key}
      data-buildable={unbuildable ? "false" : "true"}
      onClick={() => onSelect(record)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(record);
        }
      }}
      sx={{ cursor: "pointer", "&:focus-visible": { outline: "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))", outlineOffset: -1 } }}
    >
      <TableCell sx={{ maxWidth: 0, width: "38%" }}>
        <Typography variant="body2" noWrap title={name} sx={{ fontWeight: 500 }}>{name}</Typography>
        <Typography variant="caption" component="p" noWrap title={record.key} sx={{ color: "text.secondary", ...MONO_SX }}>{record.key}</Typography>
      </TableCell>
      <TableCell sx={{ maxWidth: 0, width: "16%" }}>
        <Typography variant="body2" noWrap title={vendor} data-testid="images-result-vendor">{vendor ?? "–"}</Typography>
        {folder ? (
          <Typography variant="caption" component="p" noWrap title={folder} data-testid="images-result-folder" sx={{ color: "text.secondary" }}>{folder}</Typography>
        ) : null}
      </TableCell>
      <TableCell sx={{ ...MONO_SX, fontSize: 12, whiteSpace: "nowrap", overflowWrap: "normal" }}>{record.kind ?? "–"}</TableCell>
      <TableCell sx={{ ...MONO_SX, fontSize: 12, whiteSpace: "nowrap", overflowWrap: "normal" }}>{record.version ?? "–"}</TableCell>
      <TableCell align="right" sx={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{formatSize(record.size)}</TableCell>
      <TableCell><StatusLabel tone={recordTone(record.status)} label={recordStatusLabel(record.status)} title={recordStatusHint(record.status)} /></TableCell>
      <TableCell sx={{ color: "text.secondary" }}>{record.source === "labhub" ? "LabHub" : "Local"}</TableCell>
    </TableRow>
  );
}

/** The records a search returned, as `climg search` lists them. */
export function SearchResults({ records, loading, error, filters, selectedKey, onSelect, onClearFilters }: {
  records: ImageRecord[] | undefined;
  loading: boolean;
  error?: string;
  filters: SearchFilters;
  selectedKey?: string;
  onSelect: (record: ImageRecord) => void;
  onClearFilters: () => void;
}): React.JSX.Element {
  if (error) {
    return <Typography variant="body2" role="alert" sx={{ px: 2, py: 1, color: "error.main" }}>Search failed: {error}</Typography>;
  }
  if (records === undefined) {
    return <Typography variant="body2" sx={{ px: 2, py: 1, color: "text.secondary" }}>Searching…</Typography>;
  }
  if (records.length === 0) {
    const narrowed = filtersActive(filters);
    return (
      <EmptyMessage
        testId="images-empty"
        icon={<SearchOffIcon />}
        title={narrowed ? "No images match" : "No images yet"}
        detail={narrowed
          ? "Nothing on LabHub or in the images folders matches the search and filters."
          : "The LabHub index lists nothing buildable and the images folders are empty. Upload an image file or refresh the index."}
        action={narrowed ? <Button variant="text" onClick={onClearFilters}>Clear filters</Button> : undefined}
      />
    );
  }
  return (
    <TableContainer
      data-testid="images-results"
      aria-busy={loading}
      sx={{
        flex: 1, minHeight: 0, mx: 2, mb: 2, width: "auto", border: 1, borderColor: "divider", borderRadius: controlRadius,
        opacity: loading ? 0.6 : 1, transition: "opacity 120ms ease",
        "& tbody tr:last-of-type > td": { borderBottom: 0 }
      }}
    >
      <Table size="small" stickyHeader aria-label="Images">
        <TableHead>
          <TableRow>
            <TableCell>Image</TableCell>
            <TableCell>Vendor</TableCell>
            <TableCell>Kind</TableCell>
            <TableCell>Version</TableCell>
            <TableCell align="right">Size</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Source</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {records.map((record) => (
            <ResultRow key={`${record.key}|${String(record.section ?? "")}|${String(record.id ?? "")}`} record={record} selected={record.key === selectedKey} onSelect={onSelect} />
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
