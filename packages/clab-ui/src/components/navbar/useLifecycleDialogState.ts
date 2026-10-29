// The "Run with options" dialog of the deploy menu, with the lab's deploy
// settings loaded from its lab host before it opens: the dialog starts from them.
import React from "react";

import type { ClabUiLabOperationsHost } from "../../host/labOperations";
import type { LabSettings } from "../../host/lifecycleOptions";

export interface LifecycleDialogState {
  settings?: LabSettings;
}

export function useLifecycleDialogState(labOperations: ClabUiLabOperationsHost | undefined): {
  dialog: LifecycleDialogState | null;
  open: () => void;
  close: () => void;
  saveSettings: (settings: LabSettings | undefined) => Promise<void>;
} {
  const [dialog, setDialog] = React.useState<LifecycleDialogState | null>(null);

  const open = React.useCallback(() => {
    if (!labOperations) {
      setDialog({});
      return;
    }
    // A lab host that cannot say still opens the dialog, without settings.
    void labOperations
      .labSettings()
      .catch(() => undefined)
      .then((settings) => setDialog(settings ? { settings } : {}));
  }, [labOperations]);

  const close = React.useCallback(() => setDialog(null), []);

  const saveSettings = React.useCallback(
    async (settings: LabSettings | undefined) => {
      await labOperations?.saveLabSettings(settings);
    },
    [labOperations]
  );

  return { dialog, open, close, saveSettings };
}
