// The Guide tab of a topology without a guide: what one is, and a start on writing it.
import React from "react";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

import { useClabUiHost, useTopologySessionClient } from "../../../host";
import { guideFileNameFor } from "../../../guide/guideFile";
import { guideTemplate, type GuideTemplateNode } from "../../../guide/guideTemplate";
import { executeTopologyCommand } from "../../../services/topologyHostCommands";
import { useGraphStore } from "../../../stores/graphStore";
import { useIsLocked, useTopoViewerStore } from "../../../stores/topoViewerStore";
import { MONO_FONT_FAMILY } from "../../../theme/typography";

/** The lab's nodes by name, each with its kind when the topology names one. */
function templateNodes(
  nodes: ReadonlyArray<{ id: string; type?: string; data?: { extraData?: { kind?: unknown } } }>
): GuideTemplateNode[] {
  return nodes
    .filter((node) => node.type === "topology-node")
    .map((node) => {
      const kind = node.data?.extraData?.kind;
      return { name: node.id, kind: typeof kind === "string" && kind !== "" ? kind : undefined };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const GuideEmptyState: React.FC = () => {
  const yamlFileName = useTopoViewerStore((state) => state.yamlFileName);
  const isLocked = useIsLocked();
  const nudgeLock = useTopoViewerStore((state) => state.nudgeLock);
  const sessionClient = useTopologySessionClient();
  const { topoViewer } = useClabUiHost();
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileName = guideFileNameFor(yamlFileName);

  const handleCreate = React.useCallback(() => {
    if (fileName === undefined) return;
    if (isLocked) {
      nudgeLock();
      return;
    }
    setCreating(true);
    setError(null);
    // Read once, for the template: the empty state shows neither.
    const { labName } = useTopoViewerStore.getState();
    const nodes = templateNodes(useGraphStore.getState().nodes);
    executeTopologyCommand(
      { command: "createGuide", payload: { content: guideTemplate(labName, nodes) } },
      {},
      sessionClient
    )
      .then((response) => {
        // Only an accepted command wrote the file. A rejected one was sent for
        // an older version of the topology, which has been loaded again now.
        if (response.type !== "topology-host:ack") {
          setError("The topology changed in the meantime, so no guide was created. Try again.");
          return;
        }
        topoViewer.openLabFile?.({ path: fileName });
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setCreating(false));
  }, [fileName, isLocked, nudgeLock, sessionClient, topoViewer]);

  return (
    <Box
      sx={{ flex: 1, minHeight: 0, overflow: "auto", px: 3, py: 4, display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, textAlign: "center" }}
      data-testid="guide-empty"
    >
      <MenuBookOutlinedIcon sx={{ fontSize: 36, color: "text.secondary" }} />
      <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
        This lab has no guide yet
      </Typography>
      <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 380 }}>
        A guide walks someone through the lab step by step. Its code blocks can run commands on the
        nodes or type them into a node&apos;s terminal.
      </Typography>
      {fileName !== undefined && (
        <>
          <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 380 }}>
            It is the Markdown file{" "}
            <Box component="code" sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: "0.92em" }}>
              {fileName}
            </Box>{" "}
            next to the topology.
          </Typography>
          <Button
            variant="contained"
            disableElevation
            size="small"
            onClick={handleCreate}
            disabled={creating}
            // Locked, it points at the lock instead of creating the file.
            aria-describedby={isLocked ? "guide-create-locked" : undefined}
            data-testid="guide-create"
            sx={isLocked ? { opacity: 0.6 } : undefined}
          >
            Create guide
          </Button>
          {isLocked && (
            <Typography
              id="guide-create-locked"
              variant="caption"
              sx={{ color: "text.secondary" }}
              data-testid="guide-create-locked"
            >
              Unlock the lab to create a guide.
            </Typography>
          )}
        </>
      )}
      {error !== null && (
        <Alert severity="error" variant="outlined" sx={{ textAlign: "left" }} data-testid="guide-create-error">
          {error}
        </Alert>
      )}
    </Box>
  );
};
