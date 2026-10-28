// The "Run with options" and "Lab settings" dialog of the deploy menu, with the
// lab's settings loaded from its lab host before it opens.
import React from "react";

import type { ClabUiLabOperationsHost } from "../../host/labOperations";
import type { LabSettings } from "../../host/lifecycleOptions";

export interface LifecycleDialogState {
  mode: "run" | "settings";
  settings?: LabSettings;
}

export function useLifecycleDialogState(labOperations: ClabUiLabOperationsHost | undefined): {
  dialog: LifecycleDialogState | null;
  open: (mode: LifecycleDialogState["mode"]) => void;
  close: () => void;
  saveSettings: (settings: LabSettings | undefined) => Promise<void>;
} {
  const [dialog, setDialog] = React.useState<LifecycleDialogState | null>(null);

  const open = React.useCallback(
    (mode: LifecycleDialogState["mode"]) => {
      if (!labOperations) {
        setDialog({ mode });
        return;
      }
      // A lab host that cannot say still opens the dialog, without settings.
      void labOperations
        .labSettings()
        .catch(() => undefined)
        .then((settings) => setDialog(settings ? { mode, settings } : { mode }));
    },
    [labOperations]
  );

  const close = React.useCallback(() => setDialog(null), []);

  const saveSettings = React.useCallback(
    async (settings: LabSettings | undefined) => {
      await labOperations?.saveLabSettings(settings);
    },
    [labOperations]
  );

  return { dialog, open, close, saveSettings };
}
