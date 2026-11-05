/** What a configuration commit did: the configuration before on the left, after on the right. */
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";
import React, { useState } from "react";

import { floatingRadius } from "../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../theme/typography";

import { useFabric } from "./fabricContext";
import { useFabricAnswer } from "./fabricData";
import { clock, plural } from "./fabricFormat";
import { differingPart } from "./fabricHistory";
import type { FabricConfigDiff as ConfigDiffAnswer, FabricDiffLine, FabricDiffRow, FabricKeptConfig } from "./fabricTypes";
import { ErrorNote, LoadingNote, Pill, tint, toneColor } from "./fabricUi";

/** As much of the whole configuration as anyone would scroll through. */
const WHOLE = "100000";
/** Seconds between a commit and the configuration kept after it, beyond which the history was not reading. */
const EARLIER_SECONDS = 60;

const CAME = toneColor("good");
const GONE = toneColor("bad");
const MOVED = toneColor("warn");

function LineText({ line, other, color }: { line: FabricDiffLine; other: string | undefined; color: string }): React.ReactNode {
  if (other === undefined) return line.text;
  const [start, end] = differingPart(line.text, other);
  return (
    <>
      {line.text.slice(0, start)}
      <Box component="mark" sx={{ bgcolor: tint(color, 34), color: "inherit", borderRadius: "2px" }}>
        {line.text.slice(start, line.text.length - end)}
      </Box>
      {line.text.slice(line.text.length - end)}
    </>
  );
}

function rowColor(kind: string, side: "left" | "right"): string | undefined {
  if (kind === "changed") return MOVED;
  if (kind === "added") return side === "right" ? CAME : undefined;
  if (kind === "removed") return side === "left" ? GONE : undefined;
  return undefined;
}

function Side({ row, side }: { row: FabricDiffRow; side: "left" | "right" }): React.JSX.Element {
  const line = row[side];
  const color = rowColor(row.kind, side);
  if (!line) {
    return (
      <>
        <td style={{ userSelect: "none" }} />
        <td />
      </>
    );
  }
  const changeSign = side === "left" ? "−" : "+";
  const sign = row.kind === "same" ? " " : changeSign;
  const other = row.kind === "changed" ? row[side === "left" ? "right" : "left"]?.text : undefined;
  return (
    <>
      <Box component="td" sx={{ color: "text.disabled", textAlign: "right", userSelect: "none", bgcolor: color ? tint(color, 8) : undefined }}>{line.n}</Box>
      <Box component="td" sx={{ bgcolor: color ? tint(color, 8) : undefined }}>
        <Box component="span" sx={{ color: "text.disabled", userSelect: "none" }}>{sign} </Box>
        <LineText line={line} other={other} color={side === "left" ? GONE : CAME} />
      </Box>
    </>
  );
}

function keptLabel(kept: FabricKeptConfig | null | undefined): string {
  return kept ? `After commit ${kept.commit_id ?? "?"} · ${clock(kept.ts)}` : "";
}

function DiffTable({ diff, onWhole }: { diff: ConfigDiffAnswer; onWhole: () => void }): React.JSX.Element {
  return (
    <Box sx={{ overflow: "auto", maxHeight: 420, border: 1, borderColor: "divider", borderRadius: floatingRadius }}>
      <Box
        component="table"
        data-testid="fabric-config-diff-table"
        sx={{
          width: "100%", minWidth: 680, borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed", fontFamily: MONO_FONT_FAMILY, fontSize: 12,
          "& th": { position: "sticky", top: 0, bgcolor: "background.paper", fontWeight: 500, textAlign: "left", fontFamily: "inherit", color: "text.secondary", px: 1, py: 0.5, borderBottom: 1, borderColor: "divider" },
          "& td": { px: 0.75, whiteSpace: "pre-wrap", overflowWrap: "anywhere", verticalAlign: "top", lineHeight: 1.5 }
        }}
      >
        <colgroup>
          <col style={{ width: 48 }} />
          <col />
          <col style={{ width: 48 }} />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th />
            <th>{keptLabel(diff.before)}</th>
            <th />
            <th>{keptLabel(diff.after)}</th>
          </tr>
        </thead>
        <tbody>
          {(diff.rows ?? []).map((row, index) => (
            row.kind === "skip" ? (
              // The diff has no ids; its rows only ever change as a whole.
              <tr key={index}>
                <Box
                  component="td"
                  colSpan={4}
                  sx={{ textAlign: "center", color: "text.secondary", bgcolor: "action.hover", cursor: "pointer", "&&": { py: 0.25 } }}
                  onClick={onWhole}
                >
                  ⋯ {row.count} unchanged lines
                </Box>
              </tr>
            ) : (
              <tr key={index}>
                <Side row={row} side="left" />
                <Side row={row} side="right" />
              </tr>
            )
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

/** The diff of what was committed on a node at an instant, read when it is shown. */
export function FabricConfigDiff({ node, at }: { node: string; at: number | string }): React.JSX.Element {
  const { client } = useFabric();
  const [whole, setWhole] = useState(false);
  const { answer: diff, error } = useFabricAnswer<ConfigDiffAnswer>(client, {
    method: "GET",
    path: "configs/diff",
    query: { node, at: String(at), context: whole ? WHOLE : "3" }
  });
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!diff) return <LoadingNote label="Reading the configurations…" />;
  const commits = diff.commits.map((commit) => (
    <Pill key={commit.id}>commit {commit.id} · {commit.username || "?"}{commit.comment ? ` · ${commit.comment}` : ""}</Pill>
  ));
  if (!diff.before) {
    const older = diff.at && diff.after.ts - diff.at > EARLIER_SECONDS;
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75, alignItems: "flex-start" }}>
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>{commits}</Box>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {older
            ? `This commit was made before the history kept any configuration of ${node}. The first it kept is from ${clock(diff.after.ts)}.`
            : `This is the first configuration of ${node} the history kept, so there is nothing earlier to compare it with.`}
        </Typography>
      </Box>
    );
  }
  const changed = diff.added + diff.removed + diff.changed;
  return (
    <Box data-testid="fabric-config-diff" sx={{ display: "flex", flexDirection: "column", gap: 0.75, minWidth: 0 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
        {commits}
        {diff.commits.length > 1 ? (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>{plural(diff.commits.length, "commit")} between these two</Typography>
        ) : null}
        <Box sx={{ flex: 1 }} />
        <Pill tone="good">+{diff.added} added</Pill>
        <Pill tone="bad">−{diff.removed} removed</Pill>
        <Pill tone="warn">~{diff.changed} changed</Pill>
        <FormControlLabel
          sx={{ m: 0, "& .MuiFormControlLabel-label": { fontSize: 12 } }}
          control={<Checkbox size="small" checked={whole} onChange={(event) => setWhole(event.target.checked)} sx={{ p: 0.25, mr: 0.5 }} />}
          label="Whole configuration"
        />
      </Box>
      {changed > 0
        ? <DiffTable diff={diff} onWhole={() => setWhole(true)} />
        : <Typography variant="body2" sx={{ color: "text.secondary" }}>No change in the configuration: the commit left it as it was.</Typography>}
    </Box>
  );
}
