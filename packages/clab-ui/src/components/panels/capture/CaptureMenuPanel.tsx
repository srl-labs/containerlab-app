/* eslint-disable import-x/max-dependencies */
// Interface checklist shown beside a node's context menu: pick one, several or
// all interfaces and open them in one Wireshark or one per interface.
import React from "react";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import FilterNoneOutlinedIcon from "@mui/icons-material/FilterNoneOutlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import SearchIcon from "@mui/icons-material/Search";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { WiresharkIcon } from "../../context-menu/WiresharkIcon";
import { MONO_FONT_FAMILY } from "../../../theme/typography";

import {
  groupCaptureSelection,
  matchesCaptureFilter,
  type CaptureInterfaceOption,
  type CaptureRequestGroup
} from "./captureInterfaceOptions";
import { readSeparateCaptureSessions, writeSeparateCaptureSessions } from "./captureSessionPreference";
import { captureOptionName, summarizeCapture, type CaptureSummary } from "./captureSummary";

export interface CaptureMenuPanelProps {
  /** Shown on top: the name in mono, then a muted suffix, e.g. "srl1 interfaces". */
  heading: { name: string; suffix: string };
  options: readonly CaptureInterfaceOption[];
  /** Interfaces checked when the panel opens. */
  initialSelection: readonly string[];
  /** Called on every change, so the pick survives the panel closing. */
  onSelectionChange?: (interfaceNames: string[]) => void;
  /** Called with one group per capture session to open, in list order. */
  onCapture: (groups: CaptureRequestGroup[]) => void;
  /** False when the options can never share one Wireshark, e.g. the two ends of a link. */
  combinable?: boolean;
  /** Submit label and hint; defaults to the wording for one node's interfaces. */
  summarize?: typeof summarizeCapture;
  /** Label of the "one per …" choice. */
  separateLabel?: string;
}

const PANEL_WIDTH = 344;
const LIST_MAX_HEIGHT = 296;
/** Long lists get a filter field. */
const FILTER_THRESHOLD = 10;
const ROW_SELECTOR = 'input[data-capture-row="true"]';

/** Checkbox, interface, link peer, capture-only button. */
const ROW_GRID_COLUMNS = "auto minmax(0, 1fr) minmax(0, max-content) 24px";
const SELECTED_TINT = "color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 9%, transparent)";
const SELECTED_HOVER_TINT = "color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 14%, transparent)";

const PresetButton: React.FC<{
  label: string;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}> = ({ label, disabled, onClick, testId }) => (
  <Button
    size="small"
    variant="text"
    disabled={disabled}
    onClick={onClick}
    data-testid={testId}
    sx={{
      minWidth: 0,
      minHeight: 24,
      px: 0.75,
      py: 0,
      fontSize: 12,
      fontWeight: 600,
      color: "var(--vscode-textLink-foreground)",
      "&.Mui-disabled": { color: "text.disabled" }
    }}
  >
    {label}
  </Button>
);

interface PanelHeaderProps {
  heading: CaptureMenuPanelProps["heading"];
  selectedCount: number;
  totalCount: number;
  showLinked: boolean;
  linkedOnly: boolean;
  onLinked: () => void;
  onAll: () => void;
  onNone: () => void;
}

const PanelHeader: React.FC<PanelHeaderProps> = ({
  heading,
  selectedCount,
  totalCount,
  showLinked,
  linkedOnly,
  onLinked,
  onAll,
  onNone
}) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, pl: 1.25, pr: 0.5, pt: 0.75, pb: 0.5 }}>
    <Typography noWrap sx={{ flex: 1, minWidth: 0, fontSize: 12, color: "text.secondary" }}>
      <Box component="span" sx={{ fontFamily: MONO_FONT_FAMILY, color: "text.primary", fontWeight: 600 }}>
        {heading.name}
      </Box>{" "}
      {heading.suffix}
    </Typography>
    {showLinked ? (
      <PresetButton label="Linked" disabled={linkedOnly} onClick={onLinked} testId="capture-interfaces-select-linked" />
    ) : null}
    <PresetButton
      label="All"
      disabled={totalCount === 0 || selectedCount === totalCount}
      onClick={onAll}
      testId="capture-interfaces-select-all"
    />
    <PresetButton
      label="None"
      disabled={selectedCount === 0}
      onClick={onNone}
      testId="capture-interfaces-select-none"
    />
  </Box>
);

const FilterField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}> = ({ value, onChange, inputRef }) => (
  <Box sx={{ px: 1, pb: 0.75 }}>
    <TextField
      fullWidth
      size="small"
      placeholder="Filter by name or peer"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputRef={inputRef}
      slotProps={{
        htmlInput: { "aria-label": "Filter interfaces", "data-testid": "capture-interfaces-filter" },
        input: {
          sx: { height: 30, fontSize: 12.5 },
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 16, color: "text.secondary" }} />
            </InputAdornment>
          )
        }
      }}
    />
  </Box>
);

/** Right-hand detail: the link peer, the management tag, or nothing. */
const RowMeta: React.FC<{ option: CaptureInterfaceOption }> = ({ option }) => {
  const { peer } = option;
  if (peer) {
    const target = peer.endpoint !== undefined ? `${peer.node}:${peer.endpoint}` : peer.node;
    return (
      <Typography
        noWrap
        title={`Linked to ${target}`}
        sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12, color: "text.secondary" }}
      >
        → {target}
      </Typography>
    );
  }
  if (!option.isManagement) return <Box />;
  return (
    <Box
      component="span"
      title="Management interface"
      sx={{
        justifySelf: "end",
        px: 0.625,
        borderRadius: "4px",
        border: 1,
        borderColor: "divider",
        color: "text.secondary",
        fontSize: 11,
        lineHeight: "16px"
      }}
    >
      mgmt
    </Box>
  );
};

interface PanelRowProps {
  option: CaptureInterfaceOption;
  checked: boolean;
  autoFocus: boolean;
  onToggle: (name: string) => void;
  onCaptureOnly: (option: CaptureInterfaceOption) => void;
}

const PanelRow: React.FC<PanelRowProps> = ({ option, checked, autoFocus, onToggle, onCaptureOnly }) => {
  const inputId = `capture-panel-${option.name}`;
  const isDown = option.state === "down";
  const name = captureOptionName(option);
  return (
    <Box
      component="label"
      htmlFor={inputId}
      data-testid="capture-interface-row"
      data-interface={option.name}
      sx={{
        display: "grid",
        gridTemplateColumns: ROW_GRID_COLUMNS,
        alignItems: "center",
        columnGap: 0.75,
        minHeight: 30,
        pr: 0.25,
        borderRadius: "5px",
        cursor: "pointer",
        bgcolor: checked ? SELECTED_TINT : "transparent",
        transition: "background-color 120ms ease",
        "&:hover": { bgcolor: checked ? SELECTED_HOVER_TINT : "action.hover" },
        "&:hover .capture-only, &:has(:focus-visible) .capture-only": { opacity: 1 }
      }}
    >
      <Checkbox
        size="small"
        checked={checked}
        onChange={() => onToggle(option.name)}
        sx={{ p: 0.625 }}
        slotProps={{
          input: {
            id: inputId,
            "data-capture-row": "true",
            ...(autoFocus ? { "data-autofocus": "true" } : {})
          } as React.InputHTMLAttributes<HTMLInputElement>
        }}
      />
      <Box sx={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 0.75 }}>
        {option.nodeLabel !== undefined ? (
          <Typography noWrap sx={{ fontSize: 13, color: "text.secondary", flexShrink: 0 }}>
            {option.nodeLabel}
          </Typography>
        ) : null}
        <Typography
          noWrap
          sx={{
            fontFamily: MONO_FONT_FAMILY,
            fontSize: 13,
            color: isDown ? "text.secondary" : "text.primary",
            flexShrink: 0
          }}
        >
          {option.label}
        </Typography>
        {option.detail !== undefined ? (
          <Typography noWrap sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 11.5, color: "text.secondary" }}>
            {option.detail}
          </Typography>
        ) : null}
        {isDown ? (
          <Typography component="span" sx={{ fontSize: 11, color: "text.disabled", flexShrink: 0 }}>
            down
          </Typography>
        ) : null}
      </Box>
      <RowMeta option={option} />
      <Tooltip title={`Capture only ${name}`} placement="right" disableInteractive>
        <IconButton
          className="capture-only"
          size="small"
          tabIndex={-1}
          aria-label={`Capture only ${name}`}
          data-testid="capture-interface-only"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onCaptureOnly(option);
          }}
          sx={{
            width: 24,
            height: 24,
            opacity: 0,
            color: "text.secondary",
            transition: "opacity 120ms ease",
            "&:hover": { color: "primary.main" },
            "&:focus-visible": { opacity: 1 }
          }}
        >
          <WiresharkIcon sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

const OpenAsToggle: React.FC<{
  separate: boolean;
  separateLabel: string;
  onChange: (separate: boolean) => void;
}> = ({ separate, separateLabel, onChange }) => (
  <ToggleButtonGroup
    exclusive
    fullWidth
    size="small"
    value={separate ? "separate" : "combined"}
    onChange={(_event, value: unknown) => {
      if (value === "combined" || value === "separate") onChange(value === "separate");
    }}
    aria-label="Open as"
    data-testid="capture-interfaces-mode"
    sx={{ "& .MuiToggleButton-root": { minHeight: 28, py: 0.25, fontSize: 12 } }}
  >
    <ToggleButton
      value="combined"
      title="Everything picked in one Wireshark"
      data-testid="capture-interfaces-mode-combined"
    >
      <LayersOutlinedIcon sx={{ fontSize: 15 }} />
      One Wireshark
    </ToggleButton>
    <ToggleButton
      value="separate"
      title="Each in its own Wireshark"
      data-testid="capture-interfaces-mode-separate"
    >
      <FilterNoneOutlinedIcon sx={{ fontSize: 13 }} />
      {separateLabel}
    </ToggleButton>
  </ToggleButtonGroup>
);

/** Moves focus between the rows' checkboxes; ArrowUp from the first goes back to the filter. */
function moveRowFocus(root: HTMLElement, from: EventTarget, step: 1 | -1, filter: HTMLInputElement | null) {
  const rows = [...root.querySelectorAll<HTMLInputElement>(ROW_SELECTOR)];
  if (rows.length === 0) return;
  const index = rows.indexOf(from as HTMLInputElement);
  if (index === -1) {
    rows[step === 1 ? 0 : rows.length - 1].focus();
    return;
  }
  const next = index + step;
  if (next < 0) {
    (filter ?? rows[0]).focus();
    return;
  }
  rows[Math.min(next, rows.length - 1)].focus();
}

function isPrintableKey(event: React.KeyboardEvent): boolean {
  return event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey;
}

function useCaptureChecklist(
  options: readonly CaptureInterfaceOption[],
  initialSelection: readonly string[],
  onSelectionChange?: (interfaceNames: string[]) => void
) {
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set(initialSelection));
  const linked = React.useMemo(() => options.filter((option) => option.peer), [options]);

  const update = React.useCallback(
    (next: Set<string>) => {
      setSelected(next);
      onSelectionChange?.(options.filter((option) => next.has(option.name)).map((option) => option.name));
    },
    [onSelectionChange, options]
  );

  const toggle = React.useCallback(
    (name: string) => {
      const next = new Set(selected);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      update(next);
    },
    [selected, update]
  );

  const selectedCount = options.filter((option) => selected.has(option.name)).length;
  return {
    selected,
    selectedCount,
    linked,
    linkedOnly: linked.length === selectedCount && linked.every((option) => selected.has(option.name)),
    toggle,
    selectAll: () => update(new Set(options.map((option) => option.name))),
    selectNone: () => update(new Set()),
    selectLinked: () => update(new Set(linked.map((option) => option.name)))
  };
}

export const CaptureMenuPanel: React.FC<CaptureMenuPanelProps> = ({
  heading,
  options,
  initialSelection,
  onSelectionChange,
  onCapture,
  combinable = true,
  summarize = summarizeCapture,
  separateLabel = "One per interface"
}) => {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const filterRef = React.useRef<HTMLInputElement | null>(null);
  const [filter, setFilter] = React.useState("");
  const [separate, setSeparate] = React.useState(readSeparateCaptureSessions);
  const checklist = useCaptureChecklist(options, initialSelection, onSelectionChange);
  const { selected, selectedCount, linked } = checklist;

  const visible = React.useMemo(
    () => options.filter((option) => matchesCaptureFilter(option, filter)),
    [options, filter]
  );
  const groups = React.useMemo(
    () => groupCaptureSelection(options, selected, { separate }),
    [options, selected, separate]
  );
  const summary: CaptureSummary = summarize(options, selected, groups, separate);
  // Offer "One Wireshark" only when the pick can actually share one.
  const canCombine =
    combinable && groupCaptureSelection(options, selected).length < selectedCount;
  const showFilter = options.length > FILTER_THRESHOLD;
  const showLinked = linked.length > 0 && linked.length < options.length;

  const changeSeparate = React.useCallback((next: boolean) => {
    setSeparate(next);
    writeSeparateCaptureSessions(next);
  }, []);

  const submit = React.useCallback(() => {
    if (groups.length > 0) onCapture(groups);
  }, [groups, onCapture]);

  const captureOnly = React.useCallback(
    (option: CaptureInterfaceOption) => {
      onCapture(groupCaptureSelection(options, new Set([option.name])));
    },
    [onCapture, options]
  );

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const root = rootRef.current;
    if (!root || event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      // Buttons handle Enter themselves.
      if (event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      submit();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveRowFocus(root, event.target, event.key === "ArrowDown" ? 1 : -1, filterRef.current);
      return;
    }
    // Typing anywhere in the list filters it.
    if (showFilter && event.target !== filterRef.current && isPrintableKey(event)) {
      event.preventDefault();
      setFilter((current) => current + event.key);
      filterRef.current?.focus();
    }
  };

  return (
    <Box
      ref={rootRef}
      onKeyDown={handleKeyDown}
      data-testid="capture-interfaces-panel"
      sx={{ width: PANEL_WIDTH, maxWidth: "calc(100vw - 32px)", display: "flex", flexDirection: "column" }}
    >
      <PanelHeader
        heading={heading}
        selectedCount={selectedCount}
        totalCount={options.length}
        showLinked={showLinked}
        linkedOnly={checklist.linkedOnly}
        onLinked={checklist.selectLinked}
        onAll={checklist.selectAll}
        onNone={checklist.selectNone}
      />
      {showFilter ? <FilterField value={filter} onChange={setFilter} inputRef={filterRef} /> : null}
      <Box
        role="group"
        aria-label={`${heading.name} ${heading.suffix}`}
        sx={{ maxHeight: LIST_MAX_HEIGHT, overflowY: "auto", px: 0.5, pb: 0.5 }}
      >
        {visible.map((option, index) => (
          <PanelRow
            key={option.name}
            option={option}
            checked={selected.has(option.name)}
            autoFocus={index === 0}
            onToggle={checklist.toggle}
            onCaptureOnly={captureOnly}
          />
        ))}
        {visible.length === 0 ? (
          <Typography
            sx={{ px: 1, py: 2.5, textAlign: "center", fontSize: 12, color: "text.secondary" }}
            data-testid="capture-interfaces-empty"
          >
            {options.length === 0 ? "No interfaces reported yet." : `No interface matches "${filter.trim()}".`}
          </Typography>
        ) : null}
      </Box>
      <Box sx={{ borderTop: 1, borderColor: "divider", p: 1 }}>
        <Collapse in={canCombine}>
          <Box sx={{ pb: 1 }}>
            <OpenAsToggle separate={separate} separateLabel={separateLabel} onChange={changeSeparate} />
          </Box>
        </Collapse>
        {summary.hint !== undefined ? (
          <Typography
            sx={{ pb: 1, px: 0.25, fontSize: 11.5, lineHeight: 1.45, color: "text.secondary" }}
            data-testid="capture-interfaces-hint"
          >
            {summary.hint}
          </Typography>
        ) : null}
        <Button
          fullWidth
          size="small"
          variant="contained"
          disabled={selectedCount === 0}
          onClick={submit}
          startIcon={<FiberManualRecordIcon sx={{ fontSize: "10px !important" }} />}
          data-testid="capture-interfaces-submit"
          sx={{ minHeight: 32 }}
        >
          {summary.submitLabel}
        </Button>
      </Box>
    </Box>
  );
};
