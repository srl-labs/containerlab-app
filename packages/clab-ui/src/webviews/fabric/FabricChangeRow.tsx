/** One change the engine kept: a line that says what moved, and opens on all of it. */
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Box from "@mui/material/Box";
import React, { useState } from "react";

import { MONO_FONT_FAMILY } from "../../theme/typography";

import { FabricConfigDiff } from "./FabricConfigDiff";
import { clock, fullValue, hasValue, shortValue } from "./fabricFormat";
import { changedFields, listDelta, summarizeChange, type FabricFieldDelta } from "./fabricHistory";
import type { FabricChange, FabricRecord } from "./fabricTypes";
import { FieldList, MONO_SX, Pill, TextLink, tint, toneColor, type FabricTone } from "./fabricUi";

const OP_TONES: Readonly<Record<string, FabricTone>> = {
  add: "good",
  remove: "bad",
  change: "info",
  update: "neutral"
};

const FINDING_TONES: Readonly<Record<string, FabricTone>> = {
  error: "bad",
  warning: "warn",
  info: "info"
};

const PRE_SX = { m: 0, fontFamily: MONO_FONT_FAMILY, fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" } as const;
const CONFIG_EDGE = "var(--vscode-charts-purple, #a371f7)";
const FOCUS_OUTLINE = "1px solid var(--clab-ui-focus-border, var(--vscode-focusBorder))";
const CELL_ELLIPSIS_SX = { flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

function Entry({ sign, tone, value }: { sign: string; tone: FabricTone; value: unknown }): React.JSX.Element {
  return (
    <Box component="pre" sx={{ ...PRE_SX, px: 0.75, borderRadius: "3px", bgcolor: tint(toneColor(tone), 10) }}>
      {sign} {fullValue(value)}
    </Box>
  );
}

function FieldChange({ delta }: { delta: FabricFieldDelta }): React.JSX.Element {
  const isList = Array.isArray(delta.before) || Array.isArray(delta.after);
  const { gone, came } = isList ? listDelta(delta.before, delta.after) : { gone: [delta.before], came: [delta.after] };
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, minWidth: 0 }}>
      <Box component="span" sx={{ fontSize: 12, fontWeight: 600 }}>{delta.field}</Box>
      {gone.map((value, index) => <Entry key={index} sign="−" tone="bad" value={value} />)}
      {came.map((value, index) => <Entry key={index} sign="+" tone="good" value={value} />)}
      {gone.length === 0 && came.length === 0 ? <Box component="span" sx={{ fontSize: 12, color: "text.secondary" }}>reordered</Box> : null}
    </Box>
  );
}

function RecordFields({ record, omit = [] }: { record: FabricRecord; omit?: readonly string[] }): React.JSX.Element | null {
  const fields = Object.entries(record).filter(([name, value]) => name !== "node" && !omit.includes(name) && hasValue(value));
  if (fields.length === 0) return null;
  return (
    <FieldList
      fields={fields.map(([name, value]) => [
        name,
        <Box key={name} component="pre" sx={PRE_SX}>{fullValue(value)}</Box>
      ] as const)}
    />
  );
}

function ChangeDetail({ change }: { change: FabricChange }): React.ReactNode {
  if (change.report === "config-commits" && change.op !== "remove") {
    return <FabricConfigDiff node={change.node} at={change.commit?.at ?? change.ts} />;
  }
  if (change.op === "change") {
    const deltas = changedFields(change.before, change.after);
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {deltas.map((delta) => <FieldChange key={delta.field} delta={delta} />)}
        {change.after ? <RecordFields record={change.after} omit={deltas.map((delta) => delta.field)} /> : null}
      </Box>
    );
  }
  const record = change.op === "add" ? change.after : change.before;
  return record ? <RecordFields record={record} /> : null;
}

function ChangeSummary({ change }: { change: FabricChange }): React.JSX.Element {
  const summary = summarizeChange(change);
  switch (summary.type) {
    case "commit":
      return (
        <span>
          commit <b>{String(summary.id ?? "?")}</b> by {summary.user}
          {summary.comment ? <i>: {summary.comment}</i> : null}
        </span>
      );
    case "finding":
      return (
        <span>
          <b>{summary.check}</b>{" "}
          <Box component="span" sx={MONO_SX}>{summary.subject}</Box>
          {summary.moved ? <Box component="span" sx={{ color: "text.secondary" }}> {summary.moved}</Box> : null}
          {summary.detail ? <Box component="span" sx={{ color: "text.secondary" }}>: {shortValue(summary.detail)}</Box> : null}
        </span>
      );
    case "fields":
      return (
        <span>
          <Box component="span" sx={MONO_SX}>{summary.key}</Box>
          {summary.deltas.map((delta) => (
            <Box key={delta} component="span" sx={{ color: "text.secondary", ml: 1 }}>{delta}</Box>
          ))}
          {summary.more > 0 ? <Box component="span" sx={{ color: "text.secondary", ml: 1 }}>+{summary.more} more</Box> : null}
        </span>
      );
    case "record":
      return <Box component="span" sx={MONO_SX}>{summary.key}</Box>;
  }
}

function hasDetail(change: FabricChange): boolean {
  if (change.finding) return false;
  return change.op !== "update" || changedFields(change.before, change.after).length > 0;
}

function OpPill({ change }: { change: FabricChange }): React.JSX.Element {
  if (!change.finding) return <Pill tone={OP_TONES[change.op] ?? "neutral"}>{change.op}</Pill>;
  const record = change.op === "remove" ? change.before : change.after;
  const eased = change.finding === "cleared" || change.finding === "eased";
  return <Pill dot tone={eased ? "good" : FINDING_TONES[String(record?.severity)] ?? "neutral"}>{change.finding}</Pill>;
}

function Caret({ expandable, open }: { expandable: boolean; open: boolean }): React.JSX.Element {
  if (!expandable) return <Box component="span" sx={{ width: 15 }} />;
  return open ? <ExpandMoreIcon sx={{ fontSize: 15 }} /> : <ChevronRightIcon sx={{ fontSize: 15 }} />;
}

/** What caused it: a configuration commit, with the way to what that commit did. */
function Cause({ change, diffOpen, onToggleDiff }: { change: FabricChange; diffOpen: boolean; onToggleDiff: () => void }): React.JSX.Element | null {
  if (!change.cause) return null;
  return (
    <Box component="span" sx={{ display: "block", color: "text.secondary", mt: 0.25 }}>
      ← {change.cause}{" "}
      {change.commit ? <TextLink onClick={onToggleDiff}>{diffOpen ? "hide its diff" : "show its diff"}</TextLink> : null}
    </Box>
  );
}

export function FabricChangeRow({ change }: { change: FabricChange }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const expandable = hasDetail(change);
  const fromConfig = change.origin === "config";
  const toggle = () => {
    if (expandable) setOpen(!open);
  };
  return (
    <Box
      component="li"
      data-testid="fabric-change"
      data-kind={change.finding ? "finding" : change.report}
      sx={{
        listStyle: "none", fontSize: 12, borderBottom: `1px solid ${tint("var(--clab-ui-panel-border, var(--vscode-panel-border))", 55)}`,
        borderLeft: `2px solid ${fromConfig ? CONFIG_EDGE : "transparent"}`
      }}
    >
      <Box
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onClick={toggle}
        onKeyDown={(event: React.KeyboardEvent) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        }}
        sx={{
          display: "flex", alignItems: "flex-start", gap: 1, flexWrap: "wrap", px: 1, py: 0.5, cursor: expandable ? "pointer" : "default",
          "&:hover": { bgcolor: "action.hover" },
          "&:focus-visible": { outline: FOCUS_OUTLINE, outlineOffset: -1 }
        }}
      >
        <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, width: 84, flexShrink: 0, color: "text.secondary", ...MONO_SX }}>
          <Caret expandable={expandable} open={open} />
          {clock(change.ts)}
        </Box>
        <Box component="span" title={change.node} sx={{ ...CELL_ELLIPSIS_SX, width: 76, fontWeight: 500 }}>{change.node}</Box>
        <Box component="span" title={change.report} sx={{ ...CELL_ELLIPSIS_SX, width: 92, color: "text.secondary" }}>
          {change.finding ? "finding" : change.report}
        </Box>
        <Box component="span" sx={{ width: 68, flexShrink: 0 }}><OpPill change={change} /></Box>
        <Box component="span" sx={{ flex: "1 1 260px", minWidth: 0, overflowWrap: "anywhere" }}>
          {fromConfig ? <><Pill title={change.cause ? "Likely caused by a configuration commit" : "A configuration commit"}>CONFIG</Pill>{" "}</> : null}
          <ChangeSummary change={change} />
          <Cause change={change} diffOpen={diffOpen} onToggleDiff={() => setDiffOpen(!diffOpen)} />
        </Box>
      </Box>
      {diffOpen && change.commit ? (
        <Box sx={{ px: 1.5, pb: 1 }}><FabricConfigDiff node={change.commit.node} at={change.commit.at ?? change.commit.seen ?? change.ts} /></Box>
      ) : null}
      {open ? <Box sx={{ px: 1.5, pb: 1, pt: 0.25 }}><ChangeDetail change={change} /></Box> : null}
    </Box>
  );
}
