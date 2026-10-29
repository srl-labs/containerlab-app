import type { ClusterHostSettings, LabHostCheck } from "@srl-labs/containerlab-app-contract";
import {
  detectLocalEnvironment,
  type LocalLabBackendOptions
} from "@srl-labs/containerlab-lab-backend/local";

import {
  isClusterConnection,
  LOCAL_CONNECTION,
  type ConnectionManager,
  type LabConnection
} from "./connections";
import { clusterBackendOptions, getLocalBackend } from "./labBackends";

/** Detection of a local lab host; a failure to run it is one failed check. */
async function detect(options: LocalLabBackendOptions) {
  return detectLocalEnvironment(options).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      problems: [message],
      checks: [
        { id: "detect", label: "Lab host can be checked", status: "failed" as const, message }
      ],
      containerlabVersion: undefined,
      username: undefined
    };
  });
}

/**
 * Checks a local connection (this machine or a Kubernetes cluster) and
 * records what was found; what is missing shows on its root in the explorer.
 * Lab servers have nothing to check here: they answer or ask to sign in.
 */
export async function checkLocalLabHost(
  connections: ConnectionManager,
  connection: LabConnection
): Promise<LabHostCheck[]> {
  if (connection.id === LOCAL_CONNECTION.id) {
    if (!connections.localAvailable) return [];
    const environment = await detect(getLocalBackend().options);
    connections.setLocalStatus({
      available: environment.available,
      problems: environment.problems,
      checks: environment.checks,
      ...(environment.containerlabVersion !== undefined
        ? { containerlabVersion: environment.containerlabVersion }
        : {}),
      ...(environment.username !== undefined ? { username: environment.username } : {})
    });
    return environment.checks;
  }
  if (!isClusterConnection(connection)) return [];
  const environment = await detect(clusterBackendOptions(connection));
  connections.setChecks(
    connection,
    environment.checks,
    environment.available ? [] : environment.problems
  );
  return environment.checks;
}

/** The checks of cluster settings from the cluster form, before they are saved. */
export async function checkClusterSettings(settings: ClusterHostSettings): Promise<LabHostCheck[]> {
  const connection: LabConnection = {
    id: "unsaved",
    label: settings.label ?? settings.kubeContext,
    kind: "local",
    runtime: "c9s",
    kubeContext: settings.kubeContext,
    ...(settings.kubeconfig ? { kubeconfig: settings.kubeconfig } : {}),
    ...(settings.namespace ? { namespace: settings.namespace } : {}),
    ...(settings.exposeType ? { exposeType: settings.exposeType } : {}),
    ...(settings.persistence === false ? { persistence: false } : {}),
    ...(settings.imagePullSecret ? { imagePullSecret: settings.imagePullSecret } : {})
  };
  return (await detect(clusterBackendOptions(connection))).checks;
}
