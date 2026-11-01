// A lab host's page in VS Code's Containerlab settings: its card and its
// settings, which the extension keeps (This computer's in the containerlab.*
// settings, the others' in their containerlab.connections entry).
import React from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";

import type { LabHostSettingId, LabHostSettingValue } from "../host/labHostSettings";
import { clusterSettingsOf, labHostKind } from "../workspace/endpoints";
import type { EndpointConfig } from "../workspace/types";
import { useClusterConnectionRows } from "./ClusterConnectionRows";
import { LabHostSettingsPage } from "./LabHostSettingsPage";
import { LabHostsPanel, useClusterHostsSupport } from "./LabHostsPanel";
import { labHostSettingsSubject } from "./labHostEntries";
import type { LabHostsSnapshot } from "./schema";

type Request = (payload: Record<string, unknown>) => Promise<unknown>;

/** The id of This computer in the extension's lab host list. */
const THIS_COMPUTER_ID = "local";

/** The lab hosts of the settings menu: the listed ones, and This computer while it is hidden from the explorer. */
export function extensionLabHosts(labHosts: LabHostsSnapshot): EndpointConfig[] {
  const hosts = [...labHosts.hosts];
  if (labHosts.local && !labHosts.local.shown && !hosts.some((host) => host.id === THIS_COMPUTER_ID)) {
    hosts.unshift({
      id: THIS_COMPUTER_ID,
      kind: "local",
      url: "",
      label: "This computer",
      username: "",
      sessionDuration: "",
      status: "saved",
      connected: false
    });
  }
  return hosts;
}

/** Edgeshark on this computer: the extension's install and uninstall commands. */
function EdgesharkCommands(props: { request: Request }) {
  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
      <Button size="small" variant="outlined" onClick={() => void props.request({ action: "labHosts.edgeshark", operation: "install" })}>
        Install
      </Button>
      <Button
        size="small"
        variant="outlined"
        color="warning"
        onClick={() => void props.request({ action: "labHosts.edgeshark", operation: "uninstall" })}
      >
        Uninstall
      </Button>
    </Stack>
  );
}

export function ExtensionLabHostPage(props: { labHosts: LabHostsSnapshot; hostId: string; request: Request }) {
  const { labHosts, hostId, request } = props;
  const endpoint = extensionLabHosts(labHosts).find((host) => host.id === hostId);
  const support = useClusterHostsSupport(labHosts, request);
  const connection = useClusterConnectionRows({
    endpointId: hostId,
    settings: endpoint ? clusterSettingsOf(endpoint) : { kubeContext: "" },
    ...(support ? { support } : {}),
    editable: endpoint?.editable === true
  });
  if (!endpoint) return null;
  const hidden = hostId === THIS_COMPUTER_ID && labHosts.local?.shown === false;
  const kind = labHostKind(endpoint);
  const header = hidden ? (
    <Alert
      severity="info"
      variant="outlined"
      action={
        <Button size="small" variant="text" onClick={() => void request({ action: "labHosts.showLocal" })}>
          Show
        </Button>
      }
    >
      This computer is hidden from the explorer. Its settings still apply to Kubernetes lab hosts, whose labs
      containerlab on this computer deploys.
    </Alert>
  ) : (
    <LabHostsPanel labHosts={labHosts} request={request} hostId={hostId} />
  );
  const onChange = async (id: LabHostSettingId, value: LabHostSettingValue | undefined) => {
    await request({
      action: "labHosts.setting",
      endpointId: hostId,
      setting: id,
      ...(value === undefined ? { reset: true } : { value })
    });
  };
  const custom: Partial<Record<LabHostSettingId, React.ReactNode>> = {};
  if (kind === "cluster") {
    custom.kubeconfig = connection.kubeconfig;
    custom.namespaces = connection.namespaces;
  }
  if (kind === "this-computer") custom.edgeshark = <EdgesharkCommands request={request} />;
  return (
    <>
      <LabHostSettingsPage
        subject={labHostSettingsSubject(endpoint)}
        rows={labHosts.settings?.[hostId] ?? {}}
        custom={custom}
        onChange={onChange}
        header={header}
      />
      {connection.dialog}
    </>
  );
}
