// Deploy tab of Lab settings: the options this lab's deploys, redeploys,
// applies and destroys use on its lab host. Stored with the lab host, not in
// the topology file; empty fields use the lab host's defaults.
import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { SettingsField } from "../../../settings/SettingsField";
import { unsupportedReason } from "../../../host/kubernetesLimits";
import type { LabHostProfile } from "../../../host/labHostSupport";
import { C9S_EXPOSE_TYPES, type C9sExposeType } from "../../../host/lifecycleOptions";
import {
  maxWorkersError,
  timeoutDefaultLabel,
  timeoutError,
  varsFileError,
  type LifecycleOptionsForm
} from "../lifecycle-options/lifecycleOptionsForm";
import { C9sServerSettings, EXPOSE_LABELS, kubeNameError } from "../lifecycle-options/C9sDeployFields";

import type { LabDeploySettingsState } from "./useLabDeploySettings";

export interface DeployTabProps {
  state: LabDeploySettingsState;
  /** The lab host's runtime and defaults; undefined while it has not answered. */
  profile: LabHostProfile | undefined;
  /** How the UI names the lab host, e.g. "Kubernetes · kind-c9s-app". */
  hostLabel: string;
  /** The lab host takes containerlab's `--timeout`; an older lab server does not. */
  canSetTimeout: boolean;
  /** c9s through a lab server: it sets the Kubernetes options itself. */
  c9sReadOnly: boolean;
  /** Shown, not edited. Deploy settings stay editable in a locked lab: they are not topology edits. */
  readOnly?: boolean;
}

/** Whether a field holds this lab's own value or falls back to the lab host's default. */
const SourceChip: React.FC<{ own: boolean }> = ({ own }) => (
  <Chip
    size="small"
    variant="outlined"
    color={own ? "primary" : "default"}
    label={own ? "This lab" : "Lab host default"}
    sx={{ height: 20, fontSize: 11 }}
  />
);

function nodeStorageDefault(persistence: boolean | undefined): string {
  return persistence === false ? "not kept" : "kept on persistent volumes";
}

type Update = LabDeploySettingsState["update"];

/** Why the Timeout is greyed out: a lab server older than the `timeout` parameter. */
const LAB_SERVER_WITHOUT_TIMEOUT =
  "Not offered by this lab server: it runs containerlab with its own timeouts. Update clab-api-server to set one.";

const TextRow: React.FC<{
  id: string;
  title: string;
  description: string;
  value: string;
  placeholder: string;
  error?: string;
  disabledReason?: string;
  readOnly: boolean;
  type?: "number";
  onChange: (value: string) => void;
}> = ({ id, title, description, value, placeholder, error, disabledReason, readOnly, type, onChange }) => (
  <SettingsField
    title={title}
    description={disabledReason ?? description}
    metadata={disabledReason ? undefined : <SourceChip own={value.trim() !== ""} />}
  >
    <TextField
      id={id}
      size="small"
      type={type}
      value={disabledReason ? "" : value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      disabled={readOnly || disabledReason !== undefined}
      error={error !== undefined}
      helperText={error}
      slotProps={{ htmlInput: { "aria-label": title, ...(type === "number" ? { min: 1 } : {}) } }}
    />
  </SettingsField>
);

const SwitchRow: React.FC<{
  testId: string;
  title: string;
  description: string;
  checked: boolean;
  disabledReason?: string;
  readOnly: boolean;
  onChange: (checked: boolean) => void;
}> = ({ testId, title, description, checked, disabledReason, readOnly, onChange }) => (
  <SettingsField
    title={title}
    description={disabledReason ?? description}
    compactControl
    metadata={disabledReason ? undefined : <SourceChip own={checked} />}
  >
    <Switch
      size="small"
      checked={disabledReason ? false : checked}
      onChange={(event) => onChange(event.target.checked)}
      disabled={readOnly || disabledReason !== undefined}
      slotProps={{ input: { "aria-label": title } }}
      data-testid={testId}
    />
  </SettingsField>
);

/** Timeout, max workers, variables file and the Docker and Podman options. */
const ContainerlabRows: React.FC<{
  form: LifecycleOptionsForm;
  hostProfile: LabHostProfile | undefined;
  update: Update;
  canSetTimeout: boolean;
  readOnly: boolean;
}> = ({ form, hostProfile, update, canSetTimeout, readOnly }) => {
  const kubernetes = form.runtime === "c9s";
  const timeout = timeoutDefaultLabel(form.runtime, hostProfile);
  const profile = { runtime: form.runtime };
  const exportTemplateLimit = unsupportedReason(profile, "exportTemplate");
  const skipPostDeployLimit = unsupportedReason(profile, "skipPostDeploy");
  const skipLabdirAclLimit = unsupportedReason(profile, "skipLabdirAcl");
  return (
    <>
      <TextRow
        id="lab-deploy-timeout"
        title="Timeout"
        description={`How long containerlab waits for the lab runtime, e.g. 30m. Raise it when images pull slowly. Lab host default: ${timeout.text}.`}
        value={form.timeout}
        placeholder={timeout.placeholder}
        error={canSetTimeout ? timeoutError(form.timeout) : undefined}
        {...(canSetTimeout
          ? {}
          : { disabledReason: LAB_SERVER_WITHOUT_TIMEOUT })}
        readOnly={readOnly}
        onChange={(value) => update("timeout", value)}
      />
      <TextRow
        id="lab-deploy-max-workers"
        title="Max workers"
        description={`${kubernetes ? "Kubernetes requests" : "Nodes"} handled in parallel. Lab host default: no limit.`}
        value={form.maxWorkers}
        placeholder="No limit"
        error={maxWorkersError(form.maxWorkers)}
        type="number"
        readOnly={readOnly}
        onChange={(value) => update("maxWorkers", value)}
      />
      <TextRow
        id="lab-deploy-vars-file"
        title="Template variables file"
        description="Relative to the topology file. Lab host default: <topology>_vars.yml next to the topology, if any."
        value={form.varsFile}
        placeholder="<topology>_vars.yml"
        error={varsFileError(form.varsFile)}
        readOnly={readOnly}
        onChange={(value) => update("varsFile", value)}
      />
      <TextRow
        id="lab-deploy-export-template"
        title="Export template"
        description="Template of the lab's topology-data.json. Use __full to export everything. Lab host default: containerlab's."
        value={form.exportTemplate}
        placeholder="Default"
        {...(exportTemplateLimit ? { disabledReason: exportTemplateLimit } : {})}
        readOnly={readOnly}
        onChange={(value) => update("exportTemplate", value)}
      />
      <SwitchRow
        testId="lab-deploy-skip-post-deploy"
        title="Skip post-deploy actions"
        description="Skip node configuration after the containers start."
        checked={form.skipPostDeploy}
        {...(skipPostDeployLimit ? { disabledReason: skipPostDeployLimit } : {})}
        readOnly={readOnly}
        onChange={(checked) => update("skipPostDeploy", checked)}
      />
      <SwitchRow
        testId="lab-deploy-skip-labdir-acl"
        title="Skip lab directory ACLs"
        description="Skip extended file ACLs on the lab directory."
        checked={form.skipLabdirAcl}
        {...(skipLabdirAclLimit ? { disabledReason: skipLabdirAclLimit } : {})}
        readOnly={readOnly}
        onChange={(checked) => update("skipLabdirAcl", checked)}
      />
    </>
  );
};

/** The c9s options of a cluster used from this machine, over the cluster's defaults. */
const KubernetesRows: React.FC<{
  form: LifecycleOptionsForm;
  profile: LabHostProfile | undefined;
  update: Update;
  readOnly: boolean;
}> = ({ form, profile, update, readOnly }) => {
  const exposeDefault = profile?.exposeType ?? "clabernetes default";
  const persistenceOff = profile?.persistence === false;
  return (
    <>
      <TextRow
        id="lab-deploy-namespace"
        title="Namespace"
        description={`The lab's Kubernetes namespace. Lab host default: ${profile?.namespace ?? "c9s-<lab>"}.`}
        value={form.namespace}
        placeholder={profile?.namespace ?? "c9s-<lab>"}
        error={kubeNameError(form.namespace, "namespace")}
        readOnly={readOnly}
        onChange={(value) => update("namespace", value)}
      />
      <SettingsField
        title="Expose ports"
        description={`How the nodes' ports are reachable. Lab host default: ${exposeDefault}.`}
        metadata={<SourceChip own={form.exposeType !== ""} />}
      >
        <TextField
          id="lab-deploy-expose-type"
          select
          size="small"
          value={form.exposeType}
          onChange={(event) => update("exposeType", event.target.value as "" | C9sExposeType)}
          disabled={readOnly}
          slotProps={{ select: { displayEmpty: true, inputProps: { "aria-label": "Expose ports" } } }}
        >
          <MenuItem value="">
            {profile?.exposeType ? `Lab host default (${profile.exposeType})` : "Lab host default"}
          </MenuItem>
          {C9S_EXPOSE_TYPES.map((type) => (
            <MenuItem key={type} value={type}>
              {EXPOSE_LABELS[type]}
            </MenuItem>
          ))}
        </TextField>
      </SettingsField>
      <TextRow
        id="lab-deploy-image-pull-secret"
        title="Image pull secret"
        description={`A Secret in the lab's namespace for private registries. Lab host default: ${profile?.imagePullSecret ?? "none"}.`}
        value={form.imagePullSecret}
        placeholder={profile?.imagePullSecret ?? "None"}
        error={kubeNameError(form.imagePullSecret, "secret")}
        readOnly={readOnly}
        onChange={(value) => update("imagePullSecret", value)}
      />
      <SwitchRow
        testId="lab-deploy-no-persistence"
        title="No persistent volumes"
        description={
          persistenceOff
            ? "The lab host does not keep node state anyway."
            : `Nodes start from their startup config after every restart. Lab host default: node state ${nodeStorageDefault(profile?.persistence)}.`
        }
        checked={form.noPersistence || persistenceOff}
        readOnly={readOnly || persistenceOff}
        onChange={(checked) => update("noPersistence", checked)}
      />
      <SwitchRow
        testId="lab-deploy-no-topology-cr"
        title="Without a Topology resource"
        description="Create the nodes directly, without clabernetes' Topology resource."
        checked={form.noTopologyCR}
        readOnly={readOnly}
        onChange={(checked) => update("noTopologyCR", checked)}
      />
    </>
  );
};

const SubsectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography variant="overline" component="h3" sx={{ color: "text.secondary", lineHeight: 2, mt: 1 }}>
    {children}
  </Typography>
);

export const DeployTab: React.FC<DeployTabProps> = ({
  state,
  profile,
  hostLabel,
  canSetTimeout,
  c9sReadOnly,
  readOnly = false
}) => {
  const { form, stored, update } = state;
  const kubernetes = profile?.runtime === "c9s";
  return (
    <>
      <Alert severity="info" variant="outlined" data-testid="lab-deploy-storage" sx={{ py: 0.25 }}>
        Stored for this topology file on <strong>{hostLabel}</strong>, not in the topology file: the same file on
        another lab host has its own. Deploy, redeploy, apply and destroy use them, and Run with options starts from
        them. Empty fields use the lab host&apos;s defaults.
      </Alert>
      {state.loadError ? (
        <Alert severity="warning" data-testid="lab-deploy-load-error">
          The lab host did not return this lab&apos;s settings: {state.loadError}
        </Alert>
      ) : null}
      {form === undefined ? (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Loading this lab&apos;s deploy settings…
        </Typography>
      ) : (
        <>
          <SubsectionHeading>containerlab</SubsectionHeading>
          <ContainerlabRows
            form={form}
            hostProfile={profile}
            update={update}
            canSetTimeout={canSetTimeout}
            readOnly={readOnly}
          />
          {kubernetes ? (
            <>
              <SubsectionHeading>Kubernetes (c9s)</SubsectionHeading>
              {c9sReadOnly ? (
                <SettingsField
                  title="Set by the lab server"
                  description="The lab server decides these for every lab; they cannot be changed per lab."
                  wide
                >
                  <C9sServerSettings profile={profile} namespaceOnly={false} />
                </SettingsField>
              ) : (
                <KubernetesRows form={form} profile={profile} update={update} readOnly={readOnly} />
              )}
            </>
          ) : null}
          <SettingsField
            title="Use lab host defaults"
            description={
              stored === undefined && !state.dirty
                ? "This lab has no deploy settings of its own on this lab host."
                : "Empty every field above; Apply saves it."
            }
          >
            <Box>
              <Button
                variant="outlined"
                size="small"
                onClick={state.reset}
                disabled={readOnly || (stored === undefined && !state.dirty)}
                data-testid="lab-deploy-reset"
              >
                Clear all
              </Button>
            </Box>
          </SettingsField>
        </>
      )}
    </>
  );
};
