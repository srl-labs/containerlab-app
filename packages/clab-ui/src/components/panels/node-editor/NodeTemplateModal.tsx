// Modal for creating and editing custom node templates.
import React, { useCallback, useRef, useState } from "react";
import { Box, Modal } from "@mantine/core";

import { useTopoViewerStore } from "../../../stores/topoViewerStore";
import { useCustomTemplateEditor } from "../../../hooks/editor/useCustomTemplateEditor";
import { DialogCancelSaveActions } from "../../ui/dialog/DialogChrome";
import { NodeEditorView } from "../context-panel/views/NodeEditorView";
import type { NodeEditorFooterRef } from "../context-panel/views/NodeEditorView";

export const NodeTemplateModal: React.FC = () => {
  const editingCustomTemplate = useTopoViewerStore((s) => s.editingCustomTemplate);
  const editCustomTemplate = useTopoViewerStore((s) => s.editCustomTemplate);
  const { editorData, handlers } = useCustomTemplateEditor(
    editingCustomTemplate,
    editCustomTemplate
  );
  const footerRef = useRef<NodeEditorFooterRef | null>(null);
  const [, forceUpdate] = useState(0);

  const setFooterRef = useCallback((ref: NodeEditorFooterRef | null) => {
    footerRef.current = ref;
    forceUpdate((n) => n + 1);
  }, []);

  const isOpen = !!editingCustomTemplate;
  const isNew = editingCustomTemplate?.id !== "edit-custom-node";
  const title = isNew ? "Create Node Template" : "Edit Node Template";

  return (
    <Modal
      opened={isOpen}
      onClose={handlers.handleClose}
      title={title}
      size="lg"
      centered
      styles={{
        content: {
          height: "80vh",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column"
        },
        body: {
          flex: 1,
          minHeight: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }
      }}
    >
      <Box
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }}
      >
        <NodeEditorView
          nodeData={editorData}
          onSave={handlers.handleSave}
          onApply={handlers.handleApply}
          onFooterRef={setFooterRef}
        />
      </Box>
      <DialogCancelSaveActions
        onCancel={handlers.handleClose}
        onSave={() => footerRef.current?.handleSave()}
      />
    </Modal>
  );
};
