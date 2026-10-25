// Save VM snapshots of the lab's vrnetlab nodes (`containerlab tools snapshot save`).
import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import Typography from "@mui/material/Typography";

import type {
  ClabUiLabOperationsHost,
  LabSnapshotNodeResult,
  LabSnapshotSaveResult
} from "../../../host/labOperations";
import { controlRadius } from "../../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../../theme/typography";
import { DialogTitleWithClose } from "../../ui/dialog/DialogChrome";
import { InputField } from "../../ui/form/InputField";

import { buildSnapshotRequest, directoryError, formatBytes, timeoutError } from "./labOperationsForm";
import {
  CommandPreview,
  NodePicker,
  RunError,
  RunProgress,
  useOperationRun,
  useTopologyNodeNames
} from "./LabOperationParts";

export interface SnapshotSaveDialogProps {
  operations: ClabUiLabOperationsHost;
  initialNodes: string[];
  onClose: () => void;
}

const STATUS_COLOR: Record<LabSnapshotNodeResult["status"], string> = {
  success: "success.main",
  failed: "error.main",
  skipped: "text.disabled"
};

function resultDetail(result: LabSnapshotNodeResult): string {
  if (result.status === "success") {
    return [result.path, result.sizeBytes !== undefined ? formatBytes(result.sizeBytes) : undefined]
      .filter(Boolean)
      .join(" · ");
  }
  return result.error ?? result.reason ?? "";
}

const SnapshotResults: React.FC<{ result: LabSnapshotSaveResult }> = ({ result }) => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }} data-testid="lab-snapshots-result">
    <Typography variant="body2" data-testid="lab-snapshots-summary">
      {result.summary}
      {result.outputDir ? ` · ${result.outputDir}` : ""}
    </Typography>
    <Box
      component="ul"
      sx={{
        listStyle: "none",
        m: 0,
        p: 0,
        border: 1,
        borderColor: "divider",
        borderRadius: controlRadius,
        overflow: "hidden"
      }}
    >
      {result.results.map((entry) => (
        <Box
          component="li"
          key={entry.node}
          data-testid={`lab-snapshots-node-${entry.node}`}
          sx={{
            display: "flex",
            alignItems: "baseline",
            gap: 1.5,
            px: 1.5,
            py: 0.75,
            borderLeft: 3,
            borderLeftColor: STATUS_COLOR[entry.status],
            "&:not(:last-of-type)": { borderBottom: 1, borderBottomColor: "divider" }
          }}
        >
          <Typography variant="body2" sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12.5 }}>
            {entry.node}
          </Typography>
          <Typography variant="caption" sx={{ color: STATUS_COLOR[entry.status] }}>
            {entry.status}
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", ml: "auto", textAlign: "right", overflowWrap: "anywhere" }}
          >
            {resultDetail(entry)}
          </Typography>
        </Box>
      ))}
    </Box>
  </Box>
);

export const SnapshotSaveDialog: React.FC<SnapshotSaveDialogProps> = ({
  operations,
  initialNodes,
  onClose
}) => {
  const nodeNames = useTopologyNodeNames();
  const [nodes, setNodes] = React.useState(initialNodes);
  const [outputDir, setOutputDir] = React.useState("snapshots");
  const [timeout, setTimeoutValue] = React.useState("5m");
  const [state, run] = useOperationRun<LabSnapshotSaveResult>();

  const dirError = directoryError(outputDir, false);
  const durationError = timeoutError(timeout);
  const request = buildSnapshotRequest({ nodeNames: nodes, outputDir, timeout });
  const running = state.status === "running";
  const command = [
    "containerlab tools snapshot save",
    "--output-dir",
    request.outputDir ?? "snapshots",
    ...(request.nodeNames ? ["--node-filter", request.nodeNames.join(",")] : []),
    ...(request.timeout ? ["--timeout", request.timeout] : [])
  ].join(" ");

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="lab-snapshots-dialog">
      <DialogTitleWithClose
        title="Save VM snapshots"
        onClose={onClose}
        closeButtonTestId="lab-snapshots-close"
      />
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Saves the VM state of vrnetlab nodes as {"<node>.tar"}; other nodes are skipped. Deploy
          with Run with options to restore them.
        </Typography>
        <NodePicker
          testId="lab-snapshots-nodes"
          nodeNames={nodeNames}
          value={nodes}
          onChange={setNodes}
          emptyLabel="All VM nodes"
        />
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "2fr 1fr" }, gap: 2 }}>
          <InputField
            id="lab-snapshots-dir"
            label="Directory"
            value={outputDir}
            onChange={setOutputDir}
            placeholder="snapshots"
            error={dirError !== undefined}
            helperText={dirError ?? "Relative to the topology file."}
          />
          <InputField
            id="lab-snapshots-timeout"
            label="Timeout per node"
            value={timeout}
            onChange={setTimeoutValue}
            placeholder="5m"
            error={durationError !== undefined}
            helperText={durationError}
          />
        </Box>
        <CommandPreview text={command} testId="lab-snapshots-preview" />
        {state.status === "running" && (
          <RunProgress label="Saving snapshots, this can take minutes…" testId="lab-snapshots-running" />
        )}
        {state.status === "error" && <RunError message={state.message} testId="lab-snapshots-error" />}
        {state.status === "done" && <SnapshotResults result={state.result} />}
      </DialogContent>
      <DialogActions>
        <Button variant="text" size="small" onClick={onClose}>
          Close
        </Button>
        <Button
          size="small"
          onClick={() => run(operations.saveSnapshots(request))}
          disabled={running || dirError !== undefined || durationError !== undefined}
          data-testid="lab-snapshots-run"
        >
          Save snapshots
        </Button>
      </DialogActions>
    </Dialog>
  );
};
