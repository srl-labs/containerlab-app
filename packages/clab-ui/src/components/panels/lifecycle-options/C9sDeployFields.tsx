// The c9s options of deploy and redeploy: namespace, exposure, persistence, pull secret.
import React from "react";
import Box from "@mui/material/Box";

import {
  C9S_EXPOSE_TYPES,
  isValidKubeNamespace,
  isValidKubeSecretName,
  type C9sExposeType
} from "../../../host/lifecycleOptions";
import type { LabHostProfile } from "../../../host/labHostSupport";
import { InputField, SelectField } from "../../ui/form";

export interface C9sDeployFormFields {
  namespace: string;
  exposeType: "" | C9sExposeType;
  noPersistence: boolean;
  imagePullSecret: string;
  noTopologyCR: boolean;
}

/** Problem with a Kubernetes name field, if any. Empty means the default. */
export function kubeNameError(value: string, kind: "namespace" | "secret"): string | undefined {
  const name = value.trim();
  if (name === "") return undefined;
  const valid = kind === "namespace" ? isValidKubeNamespace(name) : isValidKubeSecretName(name);
  return valid ? undefined : "Lowercase letters, digits and '-' only";
}

const EXPOSE_LABELS: Record<C9sExposeType, string> = {
  None: "None: reach nodes through this app",
  ClusterIP: "ClusterIP: inside the cluster",
  LoadBalancer: "LoadBalancer: a load balancer per node",
  Headless: "Headless: DNS for each node"
};

export const C9sDeployFields: React.FC<{
  form: C9sDeployFormFields;
  /** The lab host's defaults, shown where the form leaves a field empty. */
  profile?: LabHostProfile;
  /** destroy takes only the namespace. */
  namespaceOnly: boolean;
  update: <K extends keyof C9sDeployFormFields>(key: K, value: C9sDeployFormFields[K]) => void;
  renderCheckbox: (props: {
    testId: string;
    label: string;
    description: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  }) => React.ReactNode;
}> = ({ form, profile, namespaceOnly, update, renderCheckbox }) => {
  const namespaceError = kubeNameError(form.namespace, "namespace");
  const secretError = kubeNameError(form.imagePullSecret, "secret");
  const defaultNamespace = profile?.namespace ?? "c9s-<lab>";
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }} data-testid="lifecycle-options-c9s">
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
        <InputField
          id="lifecycle-options-namespace"
          label="Namespace"
          value={form.namespace}
          onChange={(value) => update("namespace", value)}
          placeholder={defaultNamespace}
          error={namespaceError !== undefined}
          helperText={namespaceError ?? "The lab's Kubernetes namespace."}
        />
        {!namespaceOnly && (
          <SelectField
            id="lifecycle-options-expose-type"
            label="Expose ports"
            value={form.exposeType}
            onChange={(value) => update("exposeType", value as C9sDeployFormFields["exposeType"])}
            options={[
              { value: "", label: `Host default (${profile?.exposeType ?? "clabernetes default"})` },
              ...C9S_EXPOSE_TYPES.map((type) => ({ value: type, label: EXPOSE_LABELS[type] }))
            ]}
          />
        )}
      </Box>
      {!namespaceOnly && (
        <>
          <InputField
            id="lifecycle-options-image-pull-secret"
            label="Image pull secret"
            value={form.imagePullSecret}
            onChange={(value) => update("imagePullSecret", value)}
            placeholder="None"
            error={secretError !== undefined}
            helperText={secretError ?? "A Secret in the lab's namespace for private registries."}
          />
          {renderCheckbox({
            testId: "lifecycle-options-no-persistence",
            label: "No persistent volumes",
            description:
              profile?.persistence === false
                ? "The lab host does not persist node state anyway."
                : "Nodes start from their startup config after every restart.",
            checked: form.noPersistence || profile?.persistence === false,
            onChange: (checked) => update("noPersistence", checked)
          })}
          {renderCheckbox({
            testId: "lifecycle-options-no-topology-cr",
            label: "Without a Topology resource",
            description: "Create the nodes directly, without clabernetes' Topology.",
            checked: form.noTopologyCR,
            onChange: (checked) => update("noTopologyCR", checked)
          })}
        </>
      )}
    </Box>
  );
};
