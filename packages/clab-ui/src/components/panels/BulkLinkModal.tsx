// Bulk link creation dialog.
import React from "react";
import { Alert, Box, Button, Divider, Group, Modal, Stack, Text, TextInput } from "@mantine/core";

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
  <Box style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
    <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
      {index}.
    </Text>
    <Box>
      <Text size="sm" c="dimmed">
        {def.title}
      </Text>
      <Box style={{ marginTop: 2 }}>
        {def.source} → {def.target}
      </Box>
    </Box>
  </Box>
);

const ExamplesSection: React.FC = () => (
  <Alert color="blue" variant="outline">
    <Text size="sm" fw={600} mb="xs">
      Examples
    </Text>
    <Box style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: "0.875rem" }}>
      {EXAMPLES.map((def, idx) => (
        <ExampleRow key={idx} index={idx + 1} def={def} />
      ))}
    </Box>
    <Divider my="xs" />
    <Text size="sm" c="dimmed" component="div">
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          columnGap: 12,
          rowGap: 2
        }}
      >
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
    </Text>
  </Alert>
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
  }, [addEdge, canApply, getCurrentEdges, getCurrentNodes, onClose, pendingCandidates, sessionClient]);

  return (
    <>
      <Modal
        opened={isOpen}
        onClose={handleCancel}
        title="Bulk Link Devices"
        size="lg"
        centered
        data-testid="bulk-link-modal"
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Create multiple links by matching node names with patterns.
          </Text>
          <Stack gap="xs">
            <TextInput
              ref={sourceInputRef}
              label="Source Pattern"
              required
              value={sourcePattern}
              onChange={(e) => setSourcePattern(e.currentTarget.value)}
              placeholder="e.g. leaf*, srl(\d+)"
              disabled={mode !== "edit"}
              data-testid="bulk-link-source"
            />
            <TextInput
              label="Target Pattern"
              required
              value={targetPattern}
              onChange={(e) => setTargetPattern(e.currentTarget.value)}
              placeholder="e.g. spine*, client$1"
              disabled={mode !== "edit"}
              data-testid="bulk-link-target"
            />
          </Stack>
          <ExamplesSection />
          {status !== null && status.length > 0 && (
            <Alert color="blue" variant="outline">
              {status}
            </Alert>
          )}
          {!canApply && (
            <Alert color="yellow" variant="outline">
              Bulk linking is disabled while locked or in view mode.
            </Alert>
          )}
        </Stack>
        <Group justify="flex-end" mt="md">
          <Button size="xs" variant="subtle" onClick={handleCompute} data-testid="bulk-link-apply-btn">
            Apply
          </Button>
        </Group>
      </Modal>

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
