// Everything the runtime knows about the lab's containers (`containerlab inspect --details`).
import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import Typography from "@mui/material/Typography";

import type {
  ClabUiLabOperationsHost,
  LabContainerDetails,
  LabInspectDetailsResult
} from "../../../host/labOperations";
import { MONO_FONT_FAMILY } from "../../../theme/typography";
import { DialogTitleWithClose } from "../../ui/dialog/DialogChrome";

import { containerSummary } from "./labOperationsForm";
import {
  NodePicker,
  OutputBlock,
  RunError,
  RunProgress,
  useOperationRun,
  useTopologyNodeNames
} from "./LabOperationParts";

export interface InspectDetailsDialogProps {
  operations: ClabUiLabOperationsHost;
  initialNodes: string[];
  onClose: () => void;
}

const ContainerDetails: React.FC<{ entry: LabContainerDetails }> = ({ entry }) => {
  const [expanded, setExpanded] = React.useState(false);
  const summary = containerSummary(entry.details);
  return (
    <Box component="section" data-testid={`lab-details-node-${entry.node}`}>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 0.75 }}>
        <Typography variant="subtitle2" component="h3" sx={{ fontFamily: MONO_FONT_FAMILY }}>
          {entry.node}
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", overflowWrap: "anywhere" }}>
          {entry.container}
        </Typography>
        <Button
          size="small"
          variant="text"
          sx={{ ml: "auto" }}
          onClick={() => setExpanded((value) => !value)}
          data-testid={`lab-details-toggle-${entry.node}`}
        >
          {expanded ? "Hide JSON" : "Show JSON"}
        </Button>
      </Box>
      {summary.length > 0 && (
        <Box
          component="dl"
          sx={{
            display: "grid",
            gridTemplateColumns: "max-content 1fr",
            columnGap: 2,
            rowGap: 0.25,
            m: 0,
            mb: expanded ? 1 : 0
          }}
        >
          {summary.map(([label, value]) => (
            <React.Fragment key={label}>
              <Typography component="dt" variant="caption" sx={{ color: "text.secondary" }}>
                {label}
              </Typography>
              <Typography
                component="dd"
                variant="caption"
                sx={{ m: 0, fontFamily: MONO_FONT_FAMILY, overflowWrap: "anywhere" }}
              >
                {value}
              </Typography>
            </React.Fragment>
          ))}
        </Box>
      )}
      {expanded && (
        <OutputBlock
          text={JSON.stringify(entry.details, null, 2)}
          testId={`lab-details-json-${entry.node}`}
        />
      )}
    </Box>
  );
};

export const InspectDetailsDialog: React.FC<InspectDetailsDialogProps> = ({
  operations,
  initialNodes,
  onClose
}) => {
  const nodeNames = useTopologyNodeNames();
  const [nodes, setNodes] = React.useState(initialNodes);
  const [state, run] = useOperationRun<LabInspectDetailsResult>();

  // Inspect once on open, also when effects run twice in development.
  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    run(operations.inspectDetails());
  }, [operations, run]);

  const shown =
    state.status === "done"
      ? state.result.containers.filter((entry) => nodes.length === 0 || nodes.includes(entry.node))
      : [];

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth data-testid="lab-details-dialog">
      <DialogTitleWithClose
        title="Inspect details"
        onClose={onClose}
        closeButtonTestId="lab-details-close"
      />
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <NodePicker
          testId="lab-details-nodes"
          nodeNames={nodeNames}
          value={nodes}
          onChange={setNodes}
          label="Show"
          emptyLabel="All nodes"
        />
        {state.status === "running" && (
          <RunProgress label="Inspecting the lab…" testId="lab-details-loading" />
        )}
        {state.status === "error" && <RunError message={state.message} testId="lab-details-error" />}
        {state.status === "done" && shown.length === 0 && (
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            No running containers for this selection.
          </Typography>
        )}
        {shown.map((entry) => (
          <ContainerDetails key={entry.container} entry={entry} />
        ))}
      </DialogContent>
      <DialogActions>
        <Button
          variant="text"
          size="small"
          onClick={() => run(operations.inspectDetails())}
          disabled={state.status === "running"}
          data-testid="lab-details-refresh"
        >
          Refresh
        </Button>
        <Button variant="text" size="small" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
};
