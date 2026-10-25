/* eslint-disable import-x/max-dependencies */
// Run one command on chosen nodes, or on the nodes with labels (`containerlab exec`).
import React from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

import {
  nodeNameForContainer,
  type ClabUiLabOperationsHost,
  type LabExecResult
} from "../../../host/labOperations";
import { MONO_FONT_FAMILY } from "../../../theme/typography";
import { DialogTitleWithClose } from "../../ui/dialog/DialogChrome";

import {
  buildExecRequest,
  execCommandLine,
  execFormError,
  type ExecForm,
  type ExecTarget
} from "./labOperationsForm";
import {
  CommandPreview,
  NodePicker,
  OutputBlock,
  RunError,
  RunProgress,
  useOperationRun,
  useTopologyNodeNames
} from "./LabOperationParts";

export interface ExecCommandDialogProps {
  operations: ClabUiLabOperationsHost;
  initialNodes: string[];
  canUseLabels: boolean;
  onClose: () => void;
}

const ExecResults: React.FC<{ result: LabExecResult; nodeNames: string[] }> = ({
  result,
  nodeNames
}) => {
  if (result.results.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: "text.secondary" }} data-testid="lab-exec-empty">
        No node ran the command.
      </Typography>
    );
  }
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }} data-testid="lab-exec-results">
      {result.results.map((entry) => {
        const node = nodeNameForContainer(entry.container, nodeNames);
        const failed = entry.returnCode !== 0;
        return (
          <Box key={entry.container} component="section" data-testid={`lab-exec-result-${node}`}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
              <Typography variant="subtitle2" component="h3" sx={{ fontFamily: MONO_FONT_FAMILY }}>
                {node}
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                color={failed ? "error" : "success"}
                label={`exit ${entry.returnCode}`}
                data-testid={`lab-exec-code-${node}`}
              />
            </Box>
            {entry.stdout && <OutputBlock text={entry.stdout} testId={`lab-exec-stdout-${node}`} />}
            {entry.stderr && (
              <Box sx={{ mt: entry.stdout ? 0.75 : 0 }}>
                <OutputBlock text={entry.stderr} tone="error" testId={`lab-exec-stderr-${node}`} />
              </Box>
            )}
            {!entry.stdout && !entry.stderr && (
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                No output.
              </Typography>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

export const ExecCommandDialog: React.FC<ExecCommandDialogProps> = ({
  operations,
  initialNodes,
  canUseLabels,
  onClose
}) => {
  const nodeNames = useTopologyNodeNames();
  const [form, setForm] = React.useState<ExecForm>({
    target: "nodes",
    nodeNames: initialNodes,
    labels: [],
    command: ""
  });
  const [state, run] = useOperationRun<LabExecResult>();
  const update = <K extends keyof ExecForm>(key: K, value: ExecForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const error = execFormError(form);
  const request = buildExecRequest(form);
  const running = state.status === "running";
  const handleRun = () => {
    if (error !== undefined || running) return;
    run(operations.exec(request));
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth data-testid="lab-exec-dialog">
      <DialogTitleWithClose title="Run command" onClose={onClose} closeButtonTestId="lab-exec-close" />
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {canUseLabels && (
          <ToggleButtonGroup
            exclusive
            size="small"
            value={form.target}
            onChange={(_event, target: ExecTarget | null) => {
              if (target) update("target", target);
            }}
            aria-label="Run on"
          >
            <ToggleButton value="nodes" data-testid="lab-exec-target-nodes">
              Nodes
            </ToggleButton>
            <ToggleButton value="label" data-testid="lab-exec-target-label">
              Label
            </ToggleButton>
          </ToggleButtonGroup>
        )}
        {form.target === "nodes" ? (
          <NodePicker
            testId="lab-exec-nodes"
            nodeNames={nodeNames}
            value={form.nodeNames}
            onChange={(value) => update("nodeNames", value)}
            emptyLabel="All nodes"
            helperText="Leave empty to run on every node of the lab."
          />
        ) : (
          <Autocomplete
            multiple
            freeSolo
            size="small"
            options={[]}
            value={form.labels}
            onChange={(_event, value) =>
              update(
                "labels",
                value.map((label) => label.trim()).filter((label) => label.length > 0)
              )
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Labels"
                placeholder={form.labels.length === 0 ? "key=value, then Enter" : undefined}
                helperText="Nodes need every label, e.g. clab-node-kind=nokia_srlinux."
                slotProps={{
                  ...params.slotProps,
                  htmlInput: { ...params.slotProps.htmlInput, "data-testid": "lab-exec-labels" }
                }}
              />
            )}
          />
        )}
        <TextField
          size="small"
          label="Command"
          value={form.command}
          onChange={(event) => update("command", event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleRun();
            }
          }}
          placeholder="ip -br addr"
          autoFocus
          slotProps={{
            htmlInput: {
              "data-testid": "lab-exec-command",
              style: { fontFamily: MONO_FONT_FAMILY }
            }
          }}
        />
        <CommandPreview text={execCommandLine(request)} testId="lab-exec-preview" />
        {state.status === "running" && (
          <RunProgress label="Running on the nodes…" testId="lab-exec-running" />
        )}
        {state.status === "error" && <RunError message={state.message} testId="lab-exec-error" />}
        {state.status === "done" && <ExecResults result={state.result} nodeNames={nodeNames} />}
      </DialogContent>
      <DialogActions>
        <Button variant="text" size="small" onClick={onClose}>
          Close
        </Button>
        <Button
          size="small"
          onClick={handleRun}
          disabled={error !== undefined || running}
          title={error}
          data-testid="lab-exec-run"
        >
          Run
        </Button>
      </DialogActions>
    </Dialog>
  );
};
