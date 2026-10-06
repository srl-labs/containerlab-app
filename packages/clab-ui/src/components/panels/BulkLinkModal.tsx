/* eslint-disable import-x/max-dependencies */
// Bulk link creation dialog.
import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { DialogTitleWithClose } from "../ui/dialog/DialogChrome";
import { controlRadius } from "../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../theme/typography";
import { useTopologySessionClient } from "../../host";
import { useGraphActions, useGraphStore } from "../../stores/graphStore";
import { isTopoEdgeLike, isTopoNodeLike } from "../../utils/graphQueryUtils";

import { CopyableCode } from "./bulk-link/CopyableCode";
import { ConfirmBulkLinksModal } from "./bulk-link/ConfirmBulkLinksModal";
import type { LinkCandidate } from "./bulk-link/bulkLinkUtils";
import { computeAndValidateCandidates, confirmAndCreateLinks } from "./bulk-link/bulkLinkHandlers";

interface BulkLinkModalProps {
  isOpen: boolean;
  mode: "edit" | "view";
  isLocked: boolean;
  onClose: () => void;
}

const FLEX_START = "flex-start";
const PATTERN_FIELD_SX = {
  "& .MuiInputBase-input": { fontFamily: MONO_FONT_FAMILY, fontSize: 12 }
} as const;

type ExampleDefinition = {
  title: string;
  source: React.ReactNode;
  target: React.ReactNode;
};

const EXAMPLES: readonly ExampleDefinition[] = [
  {
    title: "All leaves to all spines:",
    source: <CopyableCode>leaf*</CopyableCode>,
    target: <CopyableCode>spine*</CopyableCode>
  },
  {
    title: "Pair by number (leaf1→spine1):",
    source: <CopyableCode>{"leaf(\\d+)"}</CopyableCode>,
    target: <CopyableCode>spine$1</CopyableCode>
  },
  {
    title: "Single char match:",
    source: <CopyableCode>srl?</CopyableCode>,
    target: <CopyableCode>client*</CopyableCode>
  }
] as const;

const ExampleRow: React.FC<{ index: number; def: ExampleDefinition }> = ({ index, def }) => (
  <Box sx={{ display: "flex", alignItems: FLEX_START, gap: 1 }}>
    <Typography
      variant="body2"
      sx={{
        color: "text.secondary",
        flexShrink: 0
      }}
    >
      {index}.
    </Typography>
    <Box>
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary"
        }}
      >
        {def.title}
      </Typography>
      <Box sx={{ mt: 0.25 }}>
        {def.source} → {def.target}
      </Box>
    </Box>
  </Box>
);

const ExamplesSection: React.FC = () => (
  <Box
    sx={{
      p: 1.5,
      border: 1,
      borderColor: "divider",
      borderRadius: controlRadius
    }}
  >
    <Typography variant="subtitle2" sx={{ mb: 1 }}>
      Examples
    </Typography>
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {EXAMPLES.map((def, idx) => (
        <ExampleRow key={idx} index={idx + 1} def={def} />
      ))}
    </Box>
    <Divider sx={{ my: 1.25 }} />
    <Typography
      variant="body2"
      component="div"
      sx={{
        color: "text.secondary"
      }}
    >
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 1.5, rowGap: 0.25 }}>
        <Box>
          <CopyableCode>*</CopyableCode> any chars
        </Box>
        <Box>
          <CopyableCode>?</CopyableCode> single char
        </Box>
        <Box>
          <CopyableCode>#</CopyableCode> single digit
        </Box>
        <Box>
          <CopyableCode>$1</CopyableCode> capture group
        </Box>
      </Box>
    </Typography>
  </Box>
);

export const BulkLinkModal: React.FC<BulkLinkModalProps> = ({
  isOpen,
  mode,
  isLocked,
  onClose
}) => {
  const sessionClient = useTopologySessionClient();
  const { addEdge } = useGraphActions();
  const getCurrentNodes = React.useCallback(
    () => useGraphStore.getState().nodes.filter((node) => isTopoNodeLike(node)),
    []
  );
  const getCurrentEdges = React.useCallback(
    () => useGraphStore.getState().edges.filter((edge) => isTopoEdgeLike(edge)),
    []
  );

  const [sourcePattern, setSourcePattern] = React.useState("");
  const [targetPattern, setTargetPattern] = React.useState("");
  const [status, setStatus] = React.useState<string | null>(null);
  const [pendingCandidates, setPendingCandidates] = React.useState<LinkCandidate[] | null>(null);
  const sourceInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (isOpen) {
      setStatus(null);
      setPendingCandidates(null);
      setTimeout(() => sourceInputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const canApply = mode === "edit" && !isLocked;

  const handleCancel = React.useCallback(() => {
    setPendingCandidates(null);
    setStatus(null);
    onClose();
  }, [onClose]);

  const handleCompute = React.useCallback(() => {
    const nodes = getCurrentNodes();
    const edges = getCurrentEdges();
    computeAndValidateCandidates(
      nodes,
      edges,
      sourcePattern,
      targetPattern,
      setStatus,
      setPendingCandidates
    );
  }, [getCurrentNodes, getCurrentEdges, sourcePattern, targetPattern]);

  const handleConfirmCreate = React.useCallback(async () => {
    const nodes = getCurrentNodes();
    const edges = getCurrentEdges();
    await confirmAndCreateLinks({
      nodes,
      edges,
      pendingCandidates,
      canApply,
      addEdge,
      sessionClient,
      setStatus,
      setPendingCandidates,
      onClose
    });
  }, [
    addEdge,
    canApply,
    getCurrentEdges,
    getCurrentNodes,
    onClose,
    pendingCandidates,
    sessionClient
  ]);

  return (
    <>
      <Dialog
        open={isOpen}
        onClose={handleCancel}
        maxWidth="sm"
        fullWidth
        data-testid="bulk-link-modal"
      >
        <DialogTitleWithClose
          title="Bulk Link Devices"
          onClose={handleCancel}
          closeButtonTestId="bulk-link-close-btn"
        />
        <DialogContent dividers>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary"
              }}
            >
              Create multiple links by matching node names with patterns.
            </Typography>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 0.5 }}>
              <TextField
                inputRef={sourceInputRef}
                label="Source Pattern"
                required
                size="small"
                fullWidth
                value={sourcePattern}
                onChange={(e) => setSourcePattern(e.target.value)}
                placeholder="e.g. leaf*, srl(\d+)"
                disabled={mode !== "edit"}
                data-testid="bulk-link-source"
                sx={PATTERN_FIELD_SX}
              />
              <TextField
                label="Target Pattern"
                required
                size="small"
                fullWidth
                value={targetPattern}
                onChange={(e) => setTargetPattern(e.target.value)}
                placeholder="e.g. spine*, client$1"
                disabled={mode !== "edit"}
                data-testid="bulk-link-target"
                sx={PATTERN_FIELD_SX}
              />
            </Box>
            <ExamplesSection />
            {status !== null && status.length > 0 && (
              <Alert severity="info" variant="outlined">
                {status}
              </Alert>
            )}
            {!canApply && (
              <Alert severity="warning" variant="outlined">
                Bulk linking is disabled while locked or in view mode.
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={handleCompute} data-testid="bulk-link-apply-btn">
            Apply
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmBulkLinksModal
        isOpen={!!pendingCandidates}
        count={pendingCandidates?.length ?? 0}
        sourcePattern={sourcePattern.trim()}
        targetPattern={targetPattern.trim()}
        onCancel={() => setPendingCandidates(null)}
        onConfirm={() => void handleConfirmCreate()}
      />
    </>
  );
};
