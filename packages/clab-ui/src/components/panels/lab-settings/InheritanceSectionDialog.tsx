// Edits topology defaults, one kind or one group with the node editor tabs.
import React, { useCallback, useMemo, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";

import { useTopologySessionClient } from "../../../host";
import { executeTopologyCommand } from "../../../services/topologyHostCommands";
import type { ClabNode } from "../../../core/types/topology";
import type { NodeEditorData } from "../../../core/types/editors";
import type { InheritanceSectionUpdate } from "../../../core/types/inheritance";
import {
  convertEditorChangesToYaml,
  convertToEditorData
} from "../../../core/utilities/nodeEditorConversions";
import { DialogCancelSaveActions, DialogTitleWithClose } from "../../ui/dialog/DialogChrome";
import { NodeEditorView } from "../context-panel/views/NodeEditorView";
import type { NodeEditorFooterRef } from "../context-panel/views/NodeEditorView";

/** The section being edited; a new kind or group is written on save. */
export interface InheritanceSectionTarget {
  level: "defaults" | "kind" | "group";
  name?: string;
  isNew?: boolean;
}

interface InheritanceSectionDialogProps {
  target: InheritanceSectionTarget | null;
  config: ClabNode;
  /** Names already used by sections of the same level, to block a rename onto one */
  takenNames: string[];
  readOnly: boolean;
  onClose: () => void;
}

export function describeSectionTarget(target: InheritanceSectionTarget): string {
  if (target.level === "defaults") return "Topology defaults";
  return `${target.level === "kind" ? "Kind" : "Group"} ${target.name ?? ""}`;
}

function buildEditorData(target: InheritanceSectionTarget, config: ClabNode): NodeEditorData {
  const name = target.name ?? "defaults";
  const data = convertToEditorData({ id: name, name, extraData: config }) ?? { id: name, name };
  // A kind section is about that kind, so kind-specific tabs and type options apply.
  const kind = target.level === "kind" ? target.name : data.kind;
  return { ...data, kind, section: { level: target.level, name: target.name } };
}

export const InheritanceSectionDialog: React.FC<InheritanceSectionDialogProps> = ({
  target,
  config,
  takenNames,
  readOnly,
  onClose
}) => {
  const sessionClient = useTopologySessionClient();
  const footerRef = useRef<NodeEditorFooterRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const baseline = useMemo(
    () => (target ? buildEditorData(target, config) : null),
    [target, config]
  );

  const setFooterRef = useCallback((ref: NodeEditorFooterRef | null) => {
    footerRef.current = ref;
  }, []);

  const handleClose = useCallback(() => {
    setError(null);
    onClose();
  }, [onClose]);

  const save = useCallback(
    async (data: NodeEditorData) => {
      if (!target || !baseline) return;
      const update: InheritanceSectionUpdate = {
        level: target.level,
        name: target.name,
        changes: convertEditorChangesToYaml(data, baseline)
      };
      if (target.level === "group") {
        const rename = data.name.trim();
        if (rename === "") {
          setError("A group needs a name");
          return;
        }
        if (rename !== target.name && takenNames.includes(rename)) {
          setError(`A group named ${rename} already exists`);
          return;
        }
        if (rename !== target.name) update.rename = rename;
      }
      const hasChanges =
        Object.keys(update.changes ?? {}).length > 0 || update.rename !== undefined;
      if (!hasChanges && target.isNew !== true) {
        handleClose();
        return;
      }
      try {
        await executeTopologyCommand(
          { command: "setInheritanceSection", payload: update },
          {},
          sessionClient
        );
        handleClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [target, baseline, takenNames, sessionClient, handleClose]
  );

  const handleSave = useCallback(
    (data: NodeEditorData) => {
      void save(data);
    },
    [save]
  );

  // Apply is not offered here; the dialog saves and closes.
  const handleApply = handleSave;

  return (
    <Dialog
      open={target !== null}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      data-testid="inheritance-section-dialog"
      slotProps={{ paper: { sx: { height: "80vh", maxHeight: "80vh" } } }}
    >
      <DialogTitleWithClose
        title={target ? describeSectionTarget(target) : ""}
        onClose={handleClose}
      />
      <DialogContent dividers sx={{ p: 0, overflow: "hidden" }}>
        <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
          {error !== null ? (
            <Alert severity="error" onClose={() => setError(null)} sx={{ m: 1 }}>
              {error}
            </Alert>
          ) : null}
          <NodeEditorView
            nodeData={baseline}
            onSave={handleSave}
            onApply={handleApply}
            onFooterRef={setFooterRef}
            readOnly={readOnly}
          />
        </Box>
      </DialogContent>
      <DialogCancelSaveActions
        onCancel={handleClose}
        onSave={() => footerRef.current?.handleSave()}
        cancelLabel={readOnly ? "Close" : "Cancel"}
        disableSave={readOnly}
      />
    </Dialog>
  );
};
