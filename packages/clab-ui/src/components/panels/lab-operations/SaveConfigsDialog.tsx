// Save the running configs of the lab (`containerlab save`), optionally copying them out.
import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";

import type { ClabUiLabOperationsHost, LabSaveConfigsResult } from "../../../host/labOperations";
import { DialogTitleWithClose } from "../../ui/dialog/DialogChrome";
import { InputField } from "../../ui/form/InputField";

import { buildSaveConfigsRequest, directoryError } from "./labOperationsForm";
import {
  CommandPreview,
  NodePicker,
  OutputBlock,
  RunError,
  RunProgress,
  useOperationRun,
  useTopologyNodeNames
} from "./LabOperationParts";

export interface SaveConfigsDialogProps {
  operations: ClabUiLabOperationsHost;
  initialNodes: string[];
  canCopy: boolean;
  onClose: () => void;
}

const DEFAULT_COPY_DIR = "configs";

export const SaveConfigsDialog: React.FC<SaveConfigsDialogProps> = ({
  operations,
  initialNodes,
  canCopy,
  onClose
}) => {
  const nodeNames = useTopologyNodeNames();
  const [nodes, setNodes] = React.useState(initialNodes);
  const [copy, setCopy] = React.useState(false);
  const [copyDir, setCopyDir] = React.useState(DEFAULT_COPY_DIR);
  const [state, run] = useOperationRun<LabSaveConfigsResult>();

  const copyError = copy ? directoryError(copyDir, true) : undefined;
  const request = buildSaveConfigsRequest({ nodeNames: nodes, copy: canCopy && copy, copyDir });
  const running = state.status === "running";
  const command = [
    "containerlab save",
    ...(request.nodeNames ? ["--node-filter", request.nodeNames.join(",")] : []),
    ...(request.copyDir !== undefined ? ["--copy", request.copyDir] : [])
  ].join(" ");

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth data-testid="lab-save-dialog">
      <DialogTitleWithClose title="Save configs" onClose={onClose} closeButtonTestId="lab-save-close" />
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <NodePicker
          testId="lab-save-nodes"
          nodeNames={nodeNames}
          value={nodes}
          onChange={setNodes}
          emptyLabel="All nodes"
          helperText="Saves the running config of each node into its lab directory."
        />
        {canCopy && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <FormControlLabel
              sx={{ mx: 0, gap: 0.5 }}
              data-testid="lab-save-copy"
              control={
                <Checkbox
                  size="small"
                  checked={copy}
                  onChange={(event) => setCopy(event.target.checked)}
                  sx={{ p: 0.5 }}
                />
              }
              label={<Typography variant="body2">Copy the saved configs to a directory</Typography>}
            />
            {copy && (
              <InputField
                id="lab-save-copy-dir"
                label="Directory"
                value={copyDir}
                onChange={setCopyDir}
                error={copyError !== undefined}
                helperText={
                  copyError ??
                  "Relative to the topology file. Each save adds timestamped files under <directory>/clab-<lab>/<node>/ and links the latest."
                }
              />
            )}
          </Box>
        )}
        <CommandPreview text={command} testId="lab-save-preview" />
        {state.status === "running" && <RunProgress label="Saving configs…" testId="lab-save-running" />}
        {state.status === "error" && <RunError message={state.message} testId="lab-save-error" />}
        {state.status === "done" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }} data-testid="lab-save-result">
            <Alert severity="success">
              {state.result.message || "Configs saved."}
              {state.result.copyDir ? ` Copied to ${state.result.copyDir}.` : ""}
            </Alert>
            {state.result.output && <OutputBlock text={state.result.output} />}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="text" size="small" onClick={onClose}>
          Close
        </Button>
        <Button
          size="small"
          onClick={() => run(operations.saveConfigs(request))}
          disabled={running || copyError !== undefined}
          data-testid="lab-save-run"
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
};
