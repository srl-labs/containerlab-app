/**
 * Which lab host a topology belongs to, for the topology view's lab host
 * chip: as the explorer root names it, with its status and where labs go.
 */
import * as vscode from "vscode";
import type { LabHostIdentity } from "@containerlab/clab-ui/host";

import { isClusterConnection, type LabConnection } from "./connections";
import { connectionOf, getConnections } from "./labBackends";
import { cachedLabHostInfo } from "./labHostSupport";

function identityOf(connection: LabConnection): LabHostIdentity {
  const status = getConnections()?.status(connection);
  const details: string[] = [];
  let kind: LabHostIdentity["kind"] = "this-computer";
  let runtime: LabHostIdentity["runtime"];
  if (isClusterConnection(connection)) {
    kind = "cluster";
    runtime = "c9s";
    details.push(`Context ${connection.kubeContext ?? "current context"}`);
    if (connection.kubeconfig !== undefined) details.push(`kubeconfig ${connection.kubeconfig}`);
    details.push(
      connection.namespace !== undefined
        ? `Namespace ${connection.namespace}`
        : "A namespace per lab, c9s-<lab>"
    );
  } else if (connection.kind === "api") {
    kind = "server";
    runtime = cachedLabHostInfo(connection)?.profile.runtime;
    details.push(
      connection.username !== undefined
        ? `${connection.url ?? ""} as ${connection.username}`
        : (connection.url ?? "")
    );
  } else {
    const configured = vscode.workspace
      .getConfiguration("containerlab")
      .get<string>("runtime", "docker");
    runtime = configured === "podman" ? "podman" : "docker";
  }
  return {
    id: connection.id,
    label: connection.label,
    kind,
    ...(runtime !== undefined ? { runtime } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(details.length > 0 ? { details } : {})
  };
}

/** The lab host of a topology path or file URI. */
export function labHostIdentity(labPath: string): LabHostIdentity {
  return identityOf(connectionOf(labPath));
}
