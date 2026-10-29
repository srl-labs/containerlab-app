// A lab host's page in the web and desktop settings: its card (sign in,
// connection, check, remove) and its settings, stored where this app keeps
// them: a Kubernetes lab host's in the app's cluster settings, capture
// choices in this browser.
import React, { useState } from "react";
import Typography from "@mui/material/Typography";

import { CAPTURE_METHOD_LABELS, parseCaptureMethod } from "../../host/captureMethod";
import {
  SET_BY_APP_CONFIGURATION,
  labHostSettingAccess,
  type LabHostSettingId,
  type LabHostSettingRows,
  type LabHostSettingValue
} from "../../host/labHostSettings";
import { containerlabDefaultTimeout, isC9sExposeType } from "../../host/lifecycleOptions";
import { useClusterConnectionRows } from "../../settings/ClusterConnectionRows";
import { LabHostSettingsPage } from "../../settings/LabHostSettingsPage";
import { labHostSettingsSubject } from "../../settings/labHostEntries";
import { clusterSettingsOf, labHostKind } from "../endpoints";
import {
  clearCapturePreferences,
  getSessionHostnameOverride,
  loadCapturePreferences,
  loadOwnCaptureMethod,
  persistCapturePreferences,
  setSessionHostnameOverride
} from "../state/runtimeCaptureSettings";
import type { ClusterHostSettings, EdgeSharkStatusResponse, EndpointConfig } from "../types";
import { EdgesharkControls, unavailableCaptureMethods } from "./CaptureSettingsSection";
import { EndpointManager } from "./EndpointManager";

type EndpointManagerProps = React.ComponentProps<typeof EndpointManager>;

export interface EdgesharkState {
  status: EdgeSharkStatusResponse | null;
  loading: boolean;
  error: string | null;
  action: "install" | "uninstall" | null;
  setAction: (action: "install" | "uninstall" | null) => void;
  setError: (message: string | null) => void;
  refresh: () => Promise<void>;
}

/** The deploy defaults a Kubernetes lab host keeps in the app's cluster settings. */
const CLUSTER_FIELDS: Partial<Record<LabHostSettingId, keyof ClusterHostSettings>> = {
  timeout: "deployTimeout",
  exposeType: "exposeType",
  persistence: "persistence",
  imagePullSecret: "imagePullSecret",
  noTopologyCR: "noTopologyCR"
};

function clusterRows(endpoint: EndpointConfig): LabHostSettingRows {
  return {
    timeout: {
      ...(endpoint.deployTimeout ? { value: endpoint.deployTimeout } : {}),
      defaultLabel: `${containerlabDefaultTimeout("c9s")} (containerlab default)`
    },
    exposeType: { ...(endpoint.exposeType ? { value: endpoint.exposeType } : {}), defaultLabel: "clabernetes default" },
    persistence: { ...(endpoint.persistence === false ? { value: false } : {}), defaultLabel: "On" },
    imagePullSecret: {
      ...(endpoint.imagePullSecret ? { value: endpoint.imagePullSecret } : {}),
      defaultLabel: "None"
    },
    noTopologyCR: { ...(endpoint.noTopologyCR === true ? { value: true } : {}), defaultLabel: "Off" }
  };
}

/** A cluster's settings with one deploy default changed; undefined goes back to the default. */
function withClusterSetting(
  settings: ClusterHostSettings,
  field: keyof ClusterHostSettings,
  value: LabHostSettingValue | undefined
): ClusterHostSettings {
  const next: Record<string, unknown> = { ...settings };
  if (value === undefined || value === "") delete next[field];
  else if (field === "exposeType" && !isC9sExposeType(value)) delete next[field];
  else next[field] = value;
  return next as unknown as ClusterHostSettings;
}

export function LabHostPage(props: {
  endpoint: EndpointConfig;
  manager: Omit<EndpointManagerProps, "endpoints" | "show">;
  localWireshark: boolean;
  edgeshark: EdgesharkState;
}) {
  const { endpoint, manager } = props;
  const [, setRevision] = useState(0);
  const subject = labHostSettingsSubject(endpoint);
  const kind = labHostKind(endpoint);
  const clusterHosts = manager.clusterHosts;
  const connection = useClusterConnectionRows({
    endpointId: endpoint.id,
    settings: clusterSettingsOf(endpoint),
    ...(clusterHosts ? { support: clusterHosts } : {}),
    editable: endpoint.editable === true
  });

  const ownMethod = loadOwnCaptureMethod(endpoint.id);
  const rows: LabHostSettingRows = {
    captureMethod: {
      ...(ownMethod ? { value: ownMethod } : {}),
      defaultLabel: CAPTURE_METHOD_LABELS[loadCapturePreferences().preferredAction],
      unavailableOptions: unavailableCaptureMethods(kind === "cluster" || endpoint.runtime === "c9s", props.localWireshark)
    },
    captureHostname: {
      ...(getSessionHostnameOverride(endpoint.id) ? { value: getSessionHostnameOverride(endpoint.id) } : {}),
      defaultLabel: "Found automatically",
      note: "In this browser session only."
    }
  };
  if (kind === "this-computer") {
    rows.runtime = { fixed: SET_BY_APP_CONFIGURATION, shown: endpoint.runtime === "podman" ? "Podman" : "Docker" };
    rows.timeout = {
      fixed: SET_BY_APP_CONFIGURATION,
      shown: endpoint.deployTimeout ?? `${containerlabDefaultTimeout("docker")} (containerlab default)`
    };
  }
  if (kind === "cluster") Object.assign(rows, clusterRows(endpoint));

  const custom: Partial<Record<LabHostSettingId, React.ReactNode>> = {};
  if (kind === "cluster") {
    custom.kubeconfig = connection.kubeconfig;
    custom.namespaces = connection.namespaces;
  }
  if (labHostSettingAccess("edgeshark", subject).access === "edit") {
    custom.edgeshark =
      endpoint.status === "connected" ? (
        <EdgesharkControls endpointId={endpoint.id} {...props.edgeshark} />
      ) : (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Sign in to see Edgeshark on this lab host.
        </Typography>
      );
  }

  const onChange = async (id: LabHostSettingId, value: LabHostSettingValue | undefined) => {
    if (id === "captureMethod") {
      if (value === undefined) clearCapturePreferences(endpoint.id);
      else persistCapturePreferences({ preferredAction: parseCaptureMethod(value) }, endpoint.id);
    } else if (id === "captureHostname") {
      setSessionHostnameOverride(value === undefined ? undefined : String(value), endpoint.id);
    } else {
      const field = CLUSTER_FIELDS[id];
      if (field === undefined || !clusterHosts) throw new Error("This app cannot change this setting.");
      await clusterHosts.save(withClusterSetting(clusterSettingsOf(endpoint), field, value), endpoint.id);
    }
    setRevision((revision) => revision + 1);
  };

  return (
    <>
      <LabHostSettingsPage
        subject={subject}
        rows={rows}
        custom={custom}
        onChange={onChange}
        header={<EndpointManager {...manager} endpoints={[endpoint]} show="hosts" />}
      />
      {connection.dialog}
    </>
  );
}
