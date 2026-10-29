/* eslint-disable import-x/max-dependencies */
// Deploy, redeploy or destroy the lab once with extra containerlab options,
// starting from the lab's deploy settings (Lab settings > Deploy).
import React from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import FormControlLabel from "@mui/material/FormControlLabel";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

import type { TopoViewerLifecycleAction } from "../../../host/contracts";
import { unsupportedReason, type KubernetesLimitKey } from "../../../host/kubernetesLimits";
import type { LabHostProfile } from "../../../host/labHostSupport";
import type {
  LabLifecycleOptionKind,
  LabLifecycleOptions,
  LabRuntimeKind,
  LabSettings
} from "../../../host/lifecycleOptions";
import type { DeploymentState } from "../../../core/types/topology";
import { useGraphStore } from "../../../stores/graphStore";
import { controlRadius } from "../../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../../theme/typography";
import { DialogTitleWithClose } from "../../ui/dialog/DialogChrome";
import { InputField } from "../../ui/form/InputField";

import {
  buildLifecycleRun,
  createLifecycleOptionsForm,
  defaultTimeout,
  formForHost,
  isCleanupBlocked,
  labSettingsFromForm,
  lifecycleKindTakes,
  maxWorkersError,
  timeoutError,
  varsFileError,
  type LifecycleOptionsForm
} from "./lifecycleOptionsForm";
import { SnapshotRestoreFields } from "./SnapshotRestoreFields";
import { C9sDeployFields, kubeNameError } from "./C9sDeployFields";

export interface LifecycleOptionsDialogProps {
  open: boolean;
  deploymentState: DeploymentState;
  /** The lab host can restore VM snapshots on deploy. */
  canRestoreSnapshots?: boolean;
  /** The lab host's runtime; options containerlab rejects there are hidden. */
  runtime?: LabRuntimeKind;
  /** c9s: the lab host's deploy defaults, which the c9s options override. */
  c9sProfile?: LabHostProfile;
  /** c9s: the lab host sets the c9s options itself (a lab server); they show read-only. */
  c9sReadOnly?: boolean;
  /** The lab host takes containerlab's `--timeout`; a clab-api-server does not. */
  canSetTimeout?: boolean;
  /** The lab's deploy settings on its lab host; they fill in the form. */
  labSettings?: LabSettings;
  /** Remember a run's options as the lab's deploy settings. Without it the dialog only runs actions. */
  onSaveSettings?: (settings: LabSettings | undefined) => Promise<void>;
  onClose: () => void;
  onRun: (action: TopoViewerLifecycleAction, options?: LabLifecycleOptions) => void;
}

const KINDS: readonly LabLifecycleOptionKind[] = ["deploy", "redeploy", "destroy"];

const KIND_LABELS: Record<LabLifecycleOptionKind, string> = {
  deploy: "Deploy",
  redeploy: "Redeploy",
  destroy: "Destroy"
};

const CLEANUP_DESCRIPTIONS: Record<LabLifecycleOptionKind, string> = {
  deploy: "Remove the lab directory and any containers left from an earlier run first.",
  redeploy: "Remove the lab directory between destroying and deploying.",
  destroy: "Remove the lab directory too."
};

const NODE_FILTER_HELP: Partial<Record<LabLifecycleOptionKind, string>> = {
  deploy: "Deploy only these nodes. Links to other nodes are skipped.",
  destroy: "Destroy only these nodes. The rest of the lab keeps running."
};

function isKindAvailable(kind: LabLifecycleOptionKind, deploymentState: DeploymentState): boolean {
  // A running lab is redeployed, not deployed again; a lab that is not
  // running cannot be redeployed or destroyed.
  if (kind === "deploy") return deploymentState !== "deployed";
  return deploymentState !== "undeployed";
}

function initialKind(deploymentState: DeploymentState): LabLifecycleOptionKind {
  return deploymentState === "deployed" ? "redeploy" : "deploy";
}

function useTopologyNodeNames(): string[] {
  const nodes = useGraphStore((state) => state.nodes);
  return React.useMemo(
    () =>
      nodes
        .filter((node) => node.type === "topology-node")
        .map((node) => node.id)
        .sort((a, b) => a.localeCompare(b)),
    [nodes]
  );
}

const OptionCheckbox: React.FC<{
  testId: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}> = ({ testId, label, description, checked, disabled, onChange }) => (
  <FormControlLabel
    sx={{ alignItems: "flex-start", mx: 0, gap: 0.5 }}
    disabled={disabled}
    data-testid={testId}
    control={
      <Checkbox
        size="small"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        sx={{ p: 0.5 }}
      />
    }
    label={
      <Box sx={{ pt: 0.375 }}>
        <Typography variant="body2">{label}</Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", display: "block" }}>
          {description}
        </Typography>
      </Box>
    }
  />
);

type OptionField = Parameters<typeof lifecycleKindTakes>[1];
/** Why an option is greyed out on this lab host, or undefined where it is offered. */
type Limited = (field: OptionField) => string | undefined;

/** Options Docker and Podman take that a Kubernetes (c9s) lab host refuses, and the reason to show. */
const KUBERNETES_REFUSED: Partial<Record<OptionField, KubernetesLimitKey>> = {
  nodeFilter: "nodeFilter",
  graceful: "graceful",
  keepMgmtNet: "keepMgmtNet",
  skipPostDeploy: "skipPostDeploy",
  skipLabdirAcl: "skipLabdirAcl",
  exportTemplate: "exportTemplate",
  restoreAll: "vmSnapshots"
};

/** Greyed out, not hidden: an option the action takes elsewhere but this lab host refuses. */
function limitedOn(kind: LabLifecycleOptionKind, field: OptionField, runtime: LabRuntimeKind): string | undefined {
  const key = KUBERNETES_REFUSED[field];
  if (!key || lifecycleKindTakes(kind, field, runtime) || !lifecycleKindTakes(kind, field, "docker")) return undefined;
  return unsupportedReason({ runtime }, key);
}

type FormUpdate = <K extends keyof LifecycleOptionsForm>(
  key: K,
  value: LifecycleOptionsForm[K]
) => void;

/** Deploy only, on lab hosts that can restore VM snapshots. */
const SnapshotRestoreSection: React.FC<{
  canRestore: boolean | undefined;
  form: LifecycleOptionsForm;
  nodeNames: string[];
  error: string | undefined;
  limited: Limited;
  update: FormUpdate;
}> = ({ canRestore, form, nodeNames, error, limited, update }) => {
  const reason = limited("restoreAll");
  if (reason !== undefined) {
    return (
      <OptionCheckbox
        testId="lifecycle-options-restore"
        label="Restore VM snapshots"
        description={reason}
        checked={false}
        disabled
        onChange={() => undefined}
      />
    );
  }
  if (canRestore !== true || !lifecycleKindTakes(form.kind, "restoreAll")) return null;
  return (
    <>
      <OptionCheckbox
        testId="lifecycle-options-restore"
        label="Restore VM snapshots"
        description="Boot vrnetlab nodes from saved snapshots instead of a fresh image."
        checked={form.restoreSnapshots}
        onChange={(checked) => update("restoreSnapshots", checked)}
      />
      {form.restoreSnapshots && (
        <SnapshotRestoreFields
          nodeNames={nodeNames}
          restoreAll={form.restoreAll}
          restore={form.restore}
          error={error}
          onRestoreAllChange={(value) => update("restoreAll", value)}
          onRestoreChange={(value) => update("restore", value)}
        />
      )}
    </>
  );
};

/** The options of one run, never remembered. */
const RunOnlyOptions: React.FC<{
  form: LifecycleOptionsForm;
  takes: (field: OptionField) => boolean;
  limited: Limited;
  update: FormUpdate;
}> = ({ form, takes, limited, update }) => {
  const cleanupBlocked = isCleanupBlocked(form);
  return (
    <>
      <OptionCheckbox
        testId="lifecycle-options-cleanup"
        label="Clean up"
        description={
          cleanupBlocked
            ? "Not available when only some nodes are destroyed."
            : CLEANUP_DESCRIPTIONS[form.kind]
        }
        checked={form.cleanup && !cleanupBlocked}
        disabled={cleanupBlocked}
        onChange={(checked) => update("cleanup", checked)}
      />
      {takes("graceful") && (
        <OptionCheckbox
          testId="lifecycle-options-graceful"
          label="Graceful shutdown"
          description={limited("graceful") ?? "Stop containers before removing them."}
          checked={form.graceful && limited("graceful") === undefined}
          disabled={limited("graceful") !== undefined}
          onChange={(checked) => update("graceful", checked)}
        />
      )}
      {takes("keepMgmtNet") && (
        <OptionCheckbox
          testId="lifecycle-options-keep-mgmt-net"
          label="Keep management network"
          description={limited("keepMgmtNet") ?? "Leave the management network in place."}
          checked={form.keepMgmtNet && limited("keepMgmtNet") === undefined}
          disabled={limited("keepMgmtNet") !== undefined}
          onChange={(checked) => update("keepMgmtNet", checked)}
        />
      )}
    </>
  );
};

/** Timeout, max workers and export template, where the action and host take them. */
const LimitFields: React.FC<{
  form: LifecycleOptionsForm;
  takes: (field: OptionField) => boolean;
  limited: Limited;
  canSetTimeout: boolean;
  update: FormUpdate;
}> = ({ form, takes, limited, canSetTimeout, update }) => {
  const showTimeout = canSetTimeout && takes("timeout");
  const workersError = maxWorkersError(form.maxWorkers);
  const durationError = timeoutError(form.timeout);
  if (!showTimeout && !takes("maxWorkers") && !takes("exportTemplate")) return null;
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
      {showTimeout && (
        <InputField
          id="lifecycle-options-timeout"
          label="Timeout"
          value={form.timeout}
          onChange={(value) => update("timeout", value)}
          placeholder={defaultTimeout(form.runtime)}
          error={durationError !== undefined}
          helperText={
            durationError ??
            `How long containerlab waits for the lab runtime, e.g. 30m. Raise it when images pull slowly. Empty: ${defaultTimeout(form.runtime)}.`
          }
        />
      )}
      {takes("maxWorkers") && (
        <InputField
          id="lifecycle-options-max-workers"
          label="Max workers"
          type="number"
          min={1}
          value={form.maxWorkers}
          onChange={(value) => update("maxWorkers", value)}
          placeholder="No limit"
          error={workersError !== undefined}
          helperText={
            workersError ??
            (form.runtime === "c9s"
              ? "Kubernetes requests sent in parallel."
              : "Nodes handled in parallel.")
          }
        />
      )}
      {takes("exportTemplate") && (
        <InputField
          id="lifecycle-options-export-template"
          label="Export template"
          value={limited("exportTemplate") === undefined ? form.exportTemplate : ""}
          onChange={(value) => update("exportTemplate", value)}
          placeholder="Default"
          disabled={limited("exportTemplate") !== undefined}
          helperText={limited("exportTemplate") ?? "Use __full to export everything."}
        />
      )}
    </Box>
  );
};

export const LifecycleOptionsDialog: React.FC<LifecycleOptionsDialogProps> = ({
  open,
  deploymentState,
  canRestoreSnapshots,
  runtime = "docker",
  c9sProfile,
  c9sReadOnly = false,
  canSetTimeout = false,
  labSettings,
  onSaveSettings,
  onClose,
  onRun
}) => {
  const nodeNames = useTopologyNodeNames();
  const [form, setForm] = React.useState<LifecycleOptionsForm>(() =>
    createLifecycleOptionsForm(initialKind(deploymentState), runtime, labSettings)
  );
  const [remember, setRemember] = React.useState(true);
  React.useEffect(() => {
    setForm((current) => (current.runtime === runtime ? current : { ...current, runtime }));
  }, [runtime]);
  const update = React.useCallback(
    <K extends keyof LifecycleOptionsForm>(key: K, value: LifecycleOptionsForm[K]) =>
      setForm((current) => ({ ...current, [key]: value })),
    []
  );

  // What a c9s host refuses stays visible, greyed out with why.
  const limited: Limited = (field) => limitedOn(form.kind, field, form.runtime);
  const takes = (field: OptionField) =>
    lifecycleKindTakes(form.kind, field, form.runtime) || limited(field) !== undefined;
  const varsError = varsFileError(form.varsFile);
  const showC9s = c9sProfile !== undefined && takes("namespace");
  const c9sError =
    showC9s &&
    !c9sReadOnly &&
    (kubeNameError(form.namespace, "namespace") !== undefined ||
      kubeNameError(form.imagePullSecret, "secret") !== undefined);
  const { request, snapshotError } = buildLifecycleRun(form, canRestoreSnapshots === true, canSetTimeout);
  const hostForm = formForHost(form, { canRestoreSnapshots: false, canSetTimeout });
  // Destroy takes too few options to remember; deploy and redeploy remember theirs.
  const canRemember = onSaveSettings !== undefined && form.kind !== "destroy";

  const kindAvailable = isKindAvailable(form.kind, deploymentState);

  const blocked = [
    !kindAvailable,
    maxWorkersError(form.maxWorkers) !== undefined,
    canSetTimeout && timeoutError(form.timeout) !== undefined,
    varsError !== undefined,
    snapshotError !== undefined,
    c9sError
  ].some(Boolean);

  const handleRun = () => {
    if (blocked) return;
    // The run goes ahead even when the lab host cannot remember its options.
    if (canRemember && remember) void onSaveSettings?.(labSettingsFromForm(hostForm)).catch(() => undefined);
    onRun(request.action, request.options);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      data-testid="lifecycle-options-dialog"
    >
      <DialogTitleWithClose
        title="Run with options"
        onClose={onClose}
        closeButtonTestId="lifecycle-options-close"
      />
      <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={form.kind}
          onChange={(_event, kind: LabLifecycleOptionKind | null) => {
            if (kind) update("kind", kind);
          }}
          aria-label="Lifecycle action"
        >
          {KINDS.map((kind) => (
            <ToggleButton
              key={kind}
              value={kind}
              disabled={!isKindAvailable(kind, deploymentState)}
              data-testid={`lifecycle-options-kind-${kind}`}
            >
              {KIND_LABELS[kind]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        {takes("nodeFilter") && (
          <Autocomplete
            multiple
            size="small"
            options={nodeNames}
            value={form.nodeFilter}
            onChange={(_event, value) => update("nodeFilter", value)}
            disabled={limited("nodeFilter") !== undefined}
            filterSelectedOptions
            renderInput={(params) => (
              <TextField
                {...params}
                label="Nodes"
                placeholder={form.nodeFilter.length === 0 ? "All nodes" : undefined}
                helperText={limited("nodeFilter") ?? NODE_FILTER_HELP[form.kind]}
                slotProps={{
                  ...params.slotProps,
                  htmlInput: {
                    ...params.slotProps.htmlInput,
                    "data-testid": "lifecycle-options-nodes"
                  }
                }}
              />
            )}
          />
        )}

        <LimitFields form={form} takes={takes} limited={limited} canSetTimeout={canSetTimeout} update={update} />

        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <RunOnlyOptions form={form} takes={takes} limited={limited} update={update} />
          {takes("skipPostDeploy") && (
            <OptionCheckbox
              testId="lifecycle-options-skip-post-deploy"
              label="Skip post-deploy actions"
              description={limited("skipPostDeploy") ?? "Skip node configuration after the containers start."}
              checked={form.skipPostDeploy && limited("skipPostDeploy") === undefined}
              disabled={limited("skipPostDeploy") !== undefined}
              onChange={(checked) => update("skipPostDeploy", checked)}
            />
          )}
          {takes("skipLabdirAcl") && (
            <OptionCheckbox
              testId="lifecycle-options-skip-labdir-acl"
              label="Skip lab directory ACLs"
              description={limited("skipLabdirAcl") ?? "Skip extended file ACLs on the lab directory."}
              checked={form.skipLabdirAcl && limited("skipLabdirAcl") === undefined}
              disabled={limited("skipLabdirAcl") !== undefined}
              onChange={(checked) => update("skipLabdirAcl", checked)}
            />
          )}
          <SnapshotRestoreSection
            canRestore={canRestoreSnapshots === true && takes("restoreAll")}
            form={form}
            nodeNames={nodeNames}
            error={snapshotError}
            limited={limited}
            update={update}
          />
        </Box>

        {showC9s && (
          <C9sDeployFields
            form={form}
            profile={c9sProfile}
            namespaceOnly={!takes("exposeType")}
            readOnly={c9sReadOnly}
            update={(key, value) => update(key, value as LifecycleOptionsForm[typeof key])}
            renderCheckbox={(props) => <OptionCheckbox {...props} />}
          />
        )}

        {takes("varsFile") && (
          <InputField
            id="lifecycle-options-vars-file"
            label="Template variables file"
            value={form.varsFile}
            onChange={(value) => update("varsFile", value)}
            placeholder="<topology>_vars.yml"
            error={varsError !== undefined}
            helperText={
              varsError ??
              "Relative to the topology file. Empty uses the vars file next to the topology, if any."
            }
          />
        )}

        {canRemember && (
          <OptionCheckbox
            testId="lifecycle-options-remember"
            label="Remember as this lab's deploy settings"
            description="Later deploys, redeploys and applies of this lab on this lab host use these options too. Lab settings > Deploy shows and edits them."
            checked={remember}
            onChange={setRemember}
          />
        )}

        <Box
          sx={{
            px: 1.5,
            py: 1,
            border: 1,
            borderColor: "divider",
            borderRadius: controlRadius,
            fontFamily: MONO_FONT_FAMILY,
            fontSize: 12,
            color: "text.secondary",
            overflowWrap: "anywhere"
          }}
          data-testid="lifecycle-options-command"
        >
          {request.command}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="small"
          color={form.kind === "destroy" ? "error" : "primary"}
          onClick={handleRun}
          disabled={blocked}
          data-testid="lifecycle-options-run"
        >
          {KIND_LABELS[form.kind]}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
