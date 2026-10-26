// Pieces the node and link hover cards share: a title with a state, and label/value rows.
import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

const MONO = "var(--vscode-editor-font-family, monospace)";

export function CardTitle({ title, state, stateColor, stateTestId, stateValue }: {
  title: string;
  state: string;
  /** A palette color, e.g. `success.main`. */
  stateColor: string;
  stateTestId: string;
  /** For specs: the state as a value, not its label. */
  stateValue: string;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, mb: 0.75 }}>
      <Typography variant="subtitle2" noWrap title={title} sx={{ flex: 1, minWidth: 0 }}>
        {title}
      </Typography>
      <Box
        data-testid={stateTestId}
        data-state={stateValue}
        sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}
      >
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: stateColor }} />
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {state}
        </Typography>
      </Box>
    </Box>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <Typography component="dt" variant="caption" sx={{ color: "text.secondary" }}>
      {children}
    </Typography>
  );
}

export function Value({ value, mono, testId }: { value: string; mono?: boolean; testId?: string }) {
  return (
    <Typography
      component="dd"
      variant="caption"
      noWrap
      title={value}
      data-testid={testId}
      sx={{ m: 0, minWidth: 0, fontVariantNumeric: "tabular-nums", fontFamily: mono === true ? MONO : undefined }}
    >
      {value}
    </Typography>
  );
}

/** Rows of a label and one value per column. */
export function RowGrid({ columns, children }: { columns: number; children: React.ReactNode }) {
  return (
    <Box
      component="dl"
      sx={{
        display: "grid",
        gridTemplateColumns: `auto repeat(${columns}, minmax(0, 1fr))`,
        columnGap: 1.5,
        rowGap: 0.25,
        m: 0
      }}
    >
      {children}
    </Box>
  );
}
