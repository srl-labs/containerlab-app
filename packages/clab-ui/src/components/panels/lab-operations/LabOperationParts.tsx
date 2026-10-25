// Pieces the lab operation dialogs share: node picker, output blocks, run state.
import React from "react";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { useGraphStore } from "../../../stores/graphStore";
import { controlRadius } from "../../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../../theme/typography";

export type RunState<T> =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: T }
  | { status: "error"; message: string };

/** The state of one async lab operation; results of a closed dialog are dropped. */
export function useOperationRun<T>(): [RunState<T>, (request: Promise<T>) => void] {
  const [state, setState] = React.useState<RunState<T>>({ status: "idle" });
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = React.useCallback((request: Promise<T>) => {
    setState({ status: "running" });
    request.then(
      (result) => {
        if (mounted.current) setState({ status: "done", result });
      },
      (error: unknown) => {
        if (!mounted.current) return;
        setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
      }
    );
  }, []);
  return [state, run];
}

/** Topology node names, sorted, without networks and annotations. */
export function useTopologyNodeNames(): string[] {
  const nodes = useGraphStore((state) => state.nodes);
  return React.useMemo(
    () =>
      nodes
        .filter((node) => node.type === "topology-node")
        .map((node) => node.id)
        .sort((a, b) => a.localeCompare(b)),
    [nodes]
  );
}

export const NodePicker: React.FC<{
  testId: string;
  nodeNames: string[];
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
  emptyLabel: string;
  helperText?: string;
  disabled?: boolean;
}> = ({ testId, nodeNames, value, onChange, label = "Nodes", emptyLabel, helperText, disabled }) => (
  <Autocomplete
    multiple
    size="small"
    options={nodeNames}
    value={value}
    disabled={disabled}
    onChange={(_event, next) => onChange(next)}
    filterSelectedOptions
    renderInput={(params) => (
      <TextField
        {...params}
        label={label}
        placeholder={value.length === 0 ? emptyLabel : undefined}
        helperText={helperText}
        slotProps={{
          ...params.slotProps,
          htmlInput: { ...params.slotProps.htmlInput, "data-testid": testId }
        }}
      />
    )}
  />
);

export const OutputBlock: React.FC<{ text: string; tone?: "default" | "error"; testId?: string }> = ({
  text,
  tone = "default",
  testId
}) => (
  <Box
    component="pre"
    data-testid={testId}
    sx={{
      m: 0,
      px: 1.5,
      py: 1,
      border: 1,
      borderColor: tone === "error" ? "error.main" : "divider",
      borderRadius: controlRadius,
      fontFamily: MONO_FONT_FAMILY,
      fontSize: 12,
      maxHeight: 280,
      overflow: "auto",
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      color: tone === "error" ? "error.main" : "text.primary"
    }}
  >
    {text}
  </Box>
);

export const RunProgress: React.FC<{ label: string; testId: string }> = ({ label, testId }) => (
  <Box
    sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 2, justifyContent: "center" }}
    data-testid={testId}
  >
    <CircularProgress size={18} />
    <Typography variant="body2" sx={{ color: "text.secondary" }}>
      {label}
    </Typography>
  </Box>
);

export const RunError: React.FC<{ message: string; testId: string }> = ({ message, testId }) => (
  <Alert severity="error" data-testid={testId} sx={{ overflowWrap: "anywhere" }}>
    {message}
  </Alert>
);

export const CommandPreview: React.FC<{ text: string; testId: string }> = ({ text, testId }) => (
  <Box
    sx={{
      px: 1.5,
      py: 1,
      border: 1,
      borderColor: "divider",
      borderRadius: controlRadius,
      fontFamily: MONO_FONT_FAMILY,
      fontSize: 12,
      color: "text.secondary",
      overflowWrap: "anywhere"
    }}
    data-testid={testId}
  >
    {text}
  </Box>
);
