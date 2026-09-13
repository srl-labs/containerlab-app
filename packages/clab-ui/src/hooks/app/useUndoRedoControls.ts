/**
 * useUndoRedoControls - app-level undo/redo bindings.
 */
import React from "react";

import { useTopologySessionClient } from "../../host";
import { executeTopologyCommand } from "../../services";

export interface UndoRedoControls {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function useUndoRedoControls(canUndo: boolean, canRedo: boolean): UndoRedoControls {
  const sessionClient = useTopologySessionClient();

  const undo = React.useCallback(() => {
    void executeTopologyCommand({ command: "undo" }, {}, sessionClient);
  }, [sessionClient]);

  const redo = React.useCallback(() => {
    void executeTopologyCommand({ command: "redo" }, {}, sessionClient);
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
