/* eslint-disable import-x/max-dependencies */
// Interface picker for packet capture: one, several or all interfaces of a node.
import React from "react";
import ClearIcon from "@mui/icons-material/Clear";
import FilterNoneOutlinedIcon from "@mui/icons-material/FilterNoneOutlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import SearchIcon from "@mui/icons-material/Search";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

import { WiresharkIcon } from "../../context-menu/WiresharkIcon";
import { DialogTitleWithClose } from "../../ui/dialog/DialogChrome";
import { controlRadius } from "../../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../../theme/typography";

import { CaptureInterfaceRow } from "./CaptureInterfaceRow";
import {
  groupCaptureSelection,
  matchesCaptureFilter,
  type CaptureInterfaceOption,
  type CaptureRequestGroup
} from "./captureInterfaceOptions";
import {
  readSeparateCaptureSessions,
  writeSeparateCaptureSessions
} from "./captureSessionPreference";
import { summarizeCapture, type CaptureSummary } from "./captureSummary";

/** Mount it per request: the selection starts from `initialSelection` on mount. */
export interface CaptureInterfacesDialogProps {
  open: boolean;
  /** Node name shown in the title. */
  nodeLabel: string;
  /** Container name shown under the title when it differs from the node name. */
  containerName?: string;
  options: readonly CaptureInterfaceOption[];
  /** Interfaces checked when the dialog opens. */
  initialSelection: readonly string[];
  /** False when link peers are unknown (no topology): hides peers and the linked preset. */
  linksKnown?: boolean;
  onClose: () => void;
  /** Called with one group per capture session to open, in list order. */
  onCapture: (groups: CaptureRequestGroup[]) => void;
}

const LIST_MAX_HEIGHT = 320;
const ACCENT_TINT = "color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 14%, transparent)";

type SelectAllState = "all" | "some" | "none";

function selectAllState(
  visible: readonly CaptureInterfaceOption[],
  selected: ReadonlySet<string>
): SelectAllState {
  const count = visible.filter((option) => selected.has(option.name)).length;
  if (count === 0) return "none";
  return count === visible.length ? "all" : "some";
}

function footerHint(selectedCount: number, summary: CaptureSummary, separate: boolean): string {
  if (summary.hint !== undefined) return summary.hint;
  if (selectedCount === 0) return "Pick the interfaces to capture.";
  if (selectedCount === 1) return "Tick more interfaces to capture them together.";
  if (separate) return "Each interface in its own Wireshark.";
  return `All ${selectedCount} interfaces in one Wireshark.`;
}

const CaptureDialogTitle: React.FC<{ nodeLabel: string; containerName?: string }> = ({
  nodeLabel,
  containerName
}) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0 }}>
    <Box
      sx={{
        width: 30,
        height: 30,
        borderRadius: controlRadius,
        display: "grid",
        placeItems: "center",
        flexShrink: 0,
        color: "primary.main",
        bgcolor: ACCENT_TINT
      }}
    >
      <WiresharkIcon sx={{ fontSize: 18 }} />
    </Box>
    <Box sx={{ minWidth: 0 }}>
      <Typography component="span" sx={{ display: "block", fontSize: 15, fontWeight: 600 }}>
        Capture packets on {nodeLabel}
      </Typography>
      {containerName !== undefined && containerName !== nodeLabel ? (
        <Typography
          component="span"
          noWrap
          sx={{
            display: "block",
            fontSize: 12,
            fontWeight: 400,
            color: "text.secondary",
            fontFamily: MONO_FONT_FAMILY
          }}
        >
          {containerName}
        </Typography>
      ) : null}
    </Box>
  </Box>
);

const FilterField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}> = ({ value, onChange, inputRef }) => (
  <TextField
    fullWidth
    size="small"
    placeholder="Filter by interface, alias or peer"
    value={value}
    onChange={(event) => onChange(event.target.value)}
    inputRef={inputRef}
    slotProps={{
      htmlInput: { "aria-label": "Filter interfaces", "data-testid": "capture-interfaces-filter" },
      input: {
        startAdornment: (
          <InputAdornment position="start">
            <SearchIcon sx={{ fontSize: 18, color: "text.secondary" }} />
          </InputAdornment>
        ),
        endAdornment:
          value.length > 0 ? (
            <InputAdornment position="end">
              <IconButton size="small" aria-label="Clear filter" onClick={() => onChange("")}>
                <ClearIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ) : null
      }
    }}
  />
);

interface ListHeaderProps {
  headerState: SelectAllState;
  visibleCount: number;
  totalCount: number;
  isFiltered: boolean;
  hiddenSelectedCount: number;
  linkedCount: number;
  linkedOnlySelected: boolean;
  onToggleVisible: () => void;
  onSelectLinked?: () => void;
}

const ListHeader: React.FC<ListHeaderProps> = ({
  headerState,
  visibleCount,
  totalCount,
  isFiltered,
  hiddenSelectedCount,
  linkedCount,
  linkedOnlySelected,
  onToggleVisible,
  onSelectLinked
}) => (
  <Box
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 1,
      pl: 0.5,
      pr: 1,
      minHeight: 38,
      borderBottom: 1,
      borderColor: "divider",
      bgcolor: "action.hover"
    }}
  >
    <Box
      component="label"
      sx={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0, cursor: "pointer" }}
    >
      <Checkbox
        size="small"
        checked={headerState === "all" && visibleCount > 0}
        indeterminate={headerState === "some"}
        disabled={visibleCount === 0}
        onChange={onToggleVisible}
        data-testid="capture-interfaces-select-all"
      />
      <Typography sx={{ fontSize: 12, fontWeight: 600, color: "text.secondary" }}>
        {isFiltered ? `${visibleCount} of ${totalCount} shown` : `All interfaces (${totalCount})`}
      </Typography>
      {isFiltered && hiddenSelectedCount > 0 ? (
        <Typography
          sx={{ fontSize: 12, color: "text.secondary", ml: 1 }}
          data-testid="capture-interfaces-hidden-selected"
        >
          · {hiddenSelectedCount} more selected
        </Typography>
      ) : null}
    </Box>
    {onSelectLinked ? (
      <Button
        size="small"
        variant="text"
        onClick={onSelectLinked}
        disabled={linkedOnlySelected}
        data-testid="capture-interfaces-select-linked"
        sx={{ minWidth: 0, fontSize: 12, py: 0.25 }}
      >
        Linked only ({linkedCount})
      </Button>
    ) : null}
  </Box>
);

const OpenAsToggle: React.FC<{
  separate: boolean;
  disabled: boolean;
  onChange: (separate: boolean) => void;
}> = ({ separate, disabled, onChange }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
    <Typography
      id="capture-open-as-label"
      sx={{ fontSize: 12, color: disabled ? "text.disabled" : "text.secondary" }}
    >
      Open as
    </Typography>
    <ToggleButtonGroup
      exclusive
      size="small"
      value={separate ? "separate" : "combined"}
      disabled={disabled}
      onChange={(_event, value: unknown) => {
        if (value === "combined" || value === "separate") onChange(value === "separate");
      }}
      aria-labelledby="capture-open-as-label"
      data-testid="capture-interfaces-mode"
    >
      <ToggleButton value="combined" data-testid="capture-interfaces-mode-combined">
        <LayersOutlinedIcon sx={{ fontSize: 16 }} />
        One Wireshark
      </ToggleButton>
      <ToggleButton value="separate" data-testid="capture-interfaces-mode-separate">
        <FilterNoneOutlinedIcon sx={{ fontSize: 14 }} />
        One per interface
      </ToggleButton>
    </ToggleButtonGroup>
  </Box>
);

const CaptureFooter: React.FC<{
  selectedCount: number;
  summary: CaptureSummary;
  separate: boolean;
  onSeparateChange: (separate: boolean) => void;
  onClose: () => void;
  onSubmit: () => void;
}> = ({ selectedCount, summary, separate, onSeparateChange, onClose, onSubmit }) => (
  <DialogActions sx={{ flexDirection: "column", alignItems: "stretch", gap: 1.25 }}>
    <OpenAsToggle separate={separate} disabled={selectedCount < 2} onChange={onSeparateChange} />
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0, color: "text.secondary" }}>
        <InfoOutlinedIcon sx={{ fontSize: 14, flexShrink: 0 }} />
        <Typography sx={{ fontSize: 12 }} data-testid="capture-interfaces-hint">
          {footerHint(selectedCount, summary, separate)}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", gap: 1, flexShrink: 0 }}>
        <Button variant="text" size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          startIcon={<WiresharkIcon sx={{ fontSize: 16 }} />}
          disabled={selectedCount === 0}
          onClick={onSubmit}
          data-testid="capture-interfaces-submit"
        >
          {summary.submitLabel}
        </Button>
      </Box>
    </Box>
  </DialogActions>
);

function useCaptureSelection(
  options: readonly CaptureInterfaceOption[],
  visible: readonly CaptureInterfaceOption[],
  initialSelection: readonly string[]
) {
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(initialSelection));
  const linked = React.useMemo(() => options.filter((option) => option.peer), [options]);
  const selectedNames = React.useMemo(
    () => options.filter((option) => selected.has(option.name)).map((option) => option.name),
    [options, selected]
  );

  const toggle = React.useCallback((name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const toggleVisible = React.useCallback(() => {
    setSelected((current) => {
      const next = new Set(current);
      const selectVisible = selectAllState(visible, current) !== "all";
      for (const option of visible) {
        if (selectVisible) next.add(option.name);
        else next.delete(option.name);
      }
      return next;
    });
  }, [visible]);

  const selectLinked = React.useCallback(() => {
    setSelected(new Set(linked.map((option) => option.name)));
  }, [linked]);

  return {
    selected,
    selectedNames,
    linked,
    linkedOnlySelected:
      linked.length === selectedNames.length && linked.every((option) => selected.has(option.name)),
    hiddenSelectedCount:
      selectedNames.length - visible.filter((option) => selected.has(option.name)).length,
    toggle,
    toggleVisible,
    selectLinked
  };
}

export const CaptureInterfacesDialog: React.FC<CaptureInterfacesDialogProps> = ({
  open,
  nodeLabel,
  containerName,
  options,
  initialSelection,
  linksKnown = true,
  onClose,
  onCapture
}) => {
  const [filter, setFilter] = React.useState("");
  const filterInputRef = React.useRef<HTMLInputElement | null>(null);
  const visible = React.useMemo(
    () => options.filter((option) => matchesCaptureFilter(option, filter)),
    [options, filter]
  );
  const selection = useCaptureSelection(options, visible, initialSelection);
  const { selected, selectedNames, linked } = selection;
  const isFiltered = filter.trim().length > 0;
  const showLinkedPreset = linksKnown && linked.length > 0 && linked.length < options.length;
  const [separate, setSeparate] = React.useState(readSeparateCaptureSessions);
  const groups = React.useMemo(
    () => groupCaptureSelection(options, selected, { separate }),
    [options, selected, separate]
  );

  const changeSeparate = React.useCallback((next: boolean) => {
    setSeparate(next);
    writeSeparateCaptureSessions(next);
  }, []);

  const submit = React.useCallback(() => {
    if (groups.length > 0) onCapture(groups);
  }, [groups, onCapture]);

  // Enter starts the capture from anywhere but a focused button, which handles it itself.
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    if (event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    submit();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      onKeyDown={handleKeyDown}
      data-testid="capture-interfaces-dialog"
      slotProps={{ transition: { onEntered: () => filterInputRef.current?.focus() } }}
    >
      <DialogTitleWithClose
        onClose={onClose}
        closeButtonTestId="capture-interfaces-close"
        title={<CaptureDialogTitle nodeLabel={nodeLabel} containerName={containerName} />}
      />
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
        <FilterField value={filter} onChange={setFilter} inputRef={filterInputRef} />
        <Box sx={{ border: 1, borderColor: "divider", borderRadius: controlRadius, overflow: "hidden" }}>
          <ListHeader
            headerState={selectAllState(visible, selected)}
            visibleCount={visible.length}
            totalCount={options.length}
            isFiltered={isFiltered}
            hiddenSelectedCount={selection.hiddenSelectedCount}
            linkedCount={linked.length}
            linkedOnlySelected={selection.linkedOnlySelected}
            onToggleVisible={selection.toggleVisible}
            onSelectLinked={showLinkedPreset ? selection.selectLinked : undefined}
          />
          <Box
            role="group"
            aria-label="Interfaces"
            sx={{
              maxHeight: LIST_MAX_HEIGHT,
              overflowY: "auto",
              p: 0.5,
              display: "flex",
              flexDirection: "column",
              gap: 0.25
            }}
          >
            {visible.map((option) => (
              <CaptureInterfaceRow
                key={option.name}
                option={option}
                linksKnown={linksKnown}
                checked={selected.has(option.name)}
                onToggle={selection.toggle}
              />
            ))}
            {visible.length === 0 ? (
              <Typography
                sx={{ py: 4, textAlign: "center", fontSize: 13, color: "text.secondary" }}
                data-testid="capture-interfaces-empty"
              >
                {options.length === 0
                  ? "No interfaces found. Start the node to capture its traffic."
                  : `No interface matches "${filter.trim()}".`}
              </Typography>
            ) : null}
          </Box>
        </Box>
      </DialogContent>
      <CaptureFooter
        selectedCount={selectedNames.length}
        summary={summarizeCapture(options, selected, groups, separate)}
        separate={separate}
        onSeparateChange={changeSeparate}
        onClose={onClose}
        onSubmit={submit}
      />
    </Dialog>
  );
};
