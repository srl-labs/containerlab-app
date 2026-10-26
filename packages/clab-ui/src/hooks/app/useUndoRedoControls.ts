/**
 * useUndoRedoControls - app-level undo/redo bindings.
 *
 * Walks the history the canvas shares with the source tabs.
 */
import React from "react";

import { useTopologySessionClient } from "../../host";
import { redoEdit, undoEdit } from "../../services/editHistoryCommands";
import { useEditHistoryStore } from "../../stores/editHistoryStore";

export interface UndoRedoControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoRedoControls(): UndoRedoControls {
  const sessionClient = useTopologySessionClient();
  const canUndo = useEditHistoryStore((state) => state.canUndo);
  const canRedo = useEditHistoryStore((state) => state.canRedo);

  const undo = React.useCallback(() => {
    void undoEdit(sessionClient);
  }, [sessionClient]);

  const redo = React.useCallback(() => {
    void redoEdit(sessionClient);
  }, [sessionClient]);

  return React.useMemo(
    () => ({
      undo,
      redo,
      canUndo,
      canRedo
    }),
    [undo, redo, canUndo, canRedo]
  );
}
