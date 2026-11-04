// The Deploy tab's form: the lab's deploy settings on its lab host, loaded
// when Lab settings opens and saved with Apply. They live with the lab host
// (VS Code's global state, the browser's local storage), not in the topology.
import React from "react";

import type { ClabUiLabOperationsHost } from "../../../host/labOperations";
import type { LabRuntimeKind, LabSettings } from "../../../host/lifecycleOptions";
import {
  createLifecycleOptionsForm,
  formForHost,
  labSettingsFromForm,
  maxWorkersError,
  timeoutError,
  varsFileError,
  type LifecycleOptionsForm
} from "../lifecycle-options/lifecycleOptionsForm";
import { kubeNameError } from "../lifecycle-options/C9sDeployFields";

export interface LabDeploySettingsState {
  /** Undefined until the lab host answered; the tab shows a placeholder. */
  form: LifecycleOptionsForm | undefined;
  /** The settings the lab host has stored, to tell the user what is saved. */
  stored: LabSettings | undefined;
  dirty: boolean;
  /** The lab host could not be asked, e.g. it is offline. */
  loadError: string | undefined;
  update: <K extends keyof LifecycleOptionsForm>(key: K, value: LifecycleOptionsForm[K]) => void;
  /** Empties every field: the lab uses its lab host's defaults after Apply. */
  reset: () => void;
  /** Whether a field holds something the lab host would refuse. */
  invalid: boolean;
  /** Saves the form when it changed. */
  save: () => Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useLabDeploySettings(
  labOperations: ClabUiLabOperationsHost | undefined,
  runtime: LabRuntimeKind,
  host: { canSetTimeout: boolean; c9sEditable: boolean }
): LabDeploySettingsState {
  const [form, setForm] = React.useState<LifecycleOptionsForm | undefined>(undefined);
  const [stored, setStored] = React.useState<LabSettings | undefined>(undefined);
  const [dirty, setDirty] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | undefined>(undefined);
  // Loaded once per opening; a runtime that arrives later only narrows the form.
  const runtimeRef = React.useRef(runtime);
  runtimeRef.current = runtime;

  React.useEffect(() => {
    if (!labOperations) return;
    let active = true;
    labOperations.labSettings().then(
      (settings) => {
        if (!active) return;
        setStored(settings);
        setForm(createLifecycleOptionsForm("deploy", runtimeRef.current, settings));
      },
      (error: unknown) => {
        if (!active) return;
        setLoadError(errorMessage(error));
        setForm(createLifecycleOptionsForm("deploy", runtimeRef.current));
      }
    );
    return () => {
      active = false;
    };
  }, [labOperations]);

  React.useEffect(() => {
    setForm((current) => (current && current.runtime !== runtime ? { ...current, runtime } : current));
  }, [runtime]);

  const update = React.useCallback(
    <K extends keyof LifecycleOptionsForm>(key: K, value: LifecycleOptionsForm[K]) => {
      setForm((current) => (current ? { ...current, [key]: value } : current));
      setDirty(true);
    },
    []
  );

  const reset = React.useCallback(() => {
    setForm((current) => createLifecycleOptionsForm("deploy", current?.runtime ?? runtime));
    setDirty(true);
  }, [runtime]);

  const invalid =
    form !== undefined &&
    [
      maxWorkersError(form.maxWorkers),
      host.canSetTimeout ? timeoutError(form.timeout) : undefined,
      varsFileError(form.varsFile),
      host.c9sEditable && runtime === "c9s" ? kubeNameError(form.namespace, "namespace") : undefined,
      host.c9sEditable && runtime === "c9s" ? kubeNameError(form.imagePullSecret, "secret") : undefined
    ].some((error) => error !== undefined);

  const save = React.useCallback(async () => {
    if (!labOperations || !form || !dirty) return;
    const settings = labSettingsFromForm(
      formForHost(form, { canRestoreSnapshots: false, canSetTimeout: host.canSetTimeout })
    );
    await labOperations.saveLabSettings(settings);
    setStored(settings);
    setDirty(false);
  }, [dirty, form, host.canSetTimeout, labOperations]);

  return { form, stored, dirty, loadError, update, reset, invalid, save };
}
