// The lab hosts in the settings menu, and what a host's page and the
// toolbar chip know about each, from the lab host list every app has.
import React from "react";
import AddIcon from "@mui/icons-material/Add";

import type { LabHostIdentity } from "../host/labHostIdentity";
import { labHostIdentityKindLabel } from "../host/labHostIdentity";
import type { LabHostSettingsSubject } from "../host/labHostSettings";
import { labHostKind } from "../workspace/endpoints";
import type { EndpointConfig } from "../workspace/types";
import type { SettingsNavigationItem } from "./SettingsNavigation";

/** The menu key of a lab host's page. */
const HOST_PAGE_PREFIX = "host:";
/** The menu key of "Add lab host". */
export const ADD_HOST_PAGE = "add";

export function hostPageKey(endpointId: string): string {
  return `${HOST_PAGE_PREFIX}${endpointId}`;
}

/** The lab host id of a menu key; undefined for other pages. */
export function hostPageId(key: string): string | undefined {
  return key.startsWith(HOST_PAGE_PREFIX) ? key.slice(HOST_PAGE_PREFIX.length) : undefined;
}

type HostEntry = Pick<
  EndpointConfig,
  | "id"
  | "kind"
  | "url"
  | "label"
  | "username"
  | "status"
  | "runtime"
  | "kubeContext"
  | "kubeconfig"
  | "namespace"
  | "cluster"
  | "namespacePattern"
  | "exposeType"
  | "persistence"
  | "imagePullSecret"
  | "defaultTimeout"
  | "editable"
>;

/** What the settings matrix needs of a lab host. */
export function labHostSettingsSubject(endpoint: HostEntry): LabHostSettingsSubject {
  const kind = labHostKind(endpoint);
  if (kind === "cluster") return { kind, runtime: "c9s", editable: endpoint.editable === true };
  if (kind === "this-computer") return { kind, runtime: endpoint.runtime === "podman" ? "podman" : "docker" };
  return {
    kind,
    ...(endpoint.runtime ? { runtime: endpoint.runtime } : {}),
    server: {
      ...(endpoint.cluster ? { cluster: endpoint.cluster } : {}),
      ...(endpoint.namespacePattern ? { namespacePattern: endpoint.namespacePattern } : {}),
      ...(endpoint.exposeType ? { exposeType: endpoint.exposeType } : {}),
      ...(endpoint.persistence !== undefined ? { persistence: endpoint.persistence } : {}),
      ...(endpoint.imagePullSecret ? { imagePullSecret: endpoint.imagePullSecret } : {}),
      ...(endpoint.defaultTimeout ? { defaultTimeout: endpoint.defaultTimeout } : {})
    }
  };
}

/** Which lab host it is, for the toolbar chip: name, kind, status and where labs go. */
export function labHostIdentityOf(endpoint: HostEntry): LabHostIdentity {
  const kind = labHostKind(endpoint);
  const details: string[] = [];
  if (kind === "cluster") {
    details.push(`Context ${endpoint.kubeContext ?? "current context"}`);
    if (endpoint.kubeconfig) details.push(`kubeconfig ${endpoint.kubeconfig}`);
    details.push(endpoint.namespace ? `Namespace ${endpoint.namespace}` : "A namespace per lab, c9s-<lab>");
  } else if (kind === "server") {
    details.push(endpoint.username ? `${endpoint.url} as ${endpoint.username}` : endpoint.url);
    if (endpoint.cluster) details.push(`Cluster ${endpoint.cluster}`);
    if (endpoint.namespacePattern) details.push(`Namespaces ${endpoint.namespacePattern}`);
  }
  const runtime = kind === "cluster" ? "c9s" : endpoint.runtime;
  return {
    id: endpoint.id,
    label: endpoint.label,
    kind,
    ...(runtime ? { runtime } : {}),
    status: endpoint.status,
    ...(details.length > 0 ? { details } : {})
  };
}

/** The "Lab hosts" group of the settings menu: each host, then "Add lab host". */
export function labHostNavigationItems(endpoints: readonly HostEntry[]): SettingsNavigationItem[] {
  return [
    ...endpoints.map((endpoint) => {
      const identity = labHostIdentityOf(endpoint);
      return {
        key: hostPageKey(endpoint.id),
        label: endpoint.label,
        description: "Settings for labs on this lab host",
        icon: null,
        group: "Lab hosts",
        status: endpoint.status,
        tag: labHostIdentityKindLabel(identity)
      } satisfies SettingsNavigationItem;
    }),
    {
      key: ADD_HOST_PAGE,
      label: "Add lab host",
      description: "Where should labs run?",
      icon: <AddIcon fontSize="small" />,
      group: "Lab hosts",
      accent: true
    }
  ];
}
