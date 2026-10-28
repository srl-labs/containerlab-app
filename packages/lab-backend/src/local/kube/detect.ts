import type { ResolvedLocalOptions } from "../options.ts";
import { createKubeClusterProbe, C9S_API_GROUP, type KubeAccessCheck, type KubeClusterProbe } from "./clusterProbe.ts";
import { loadKubeConfig } from "./kubeConfig.ts";
import { C9S_MIN_CLABERNETES_VERSION, C9S_MIN_CONTAINERLAB_VERSION, meetsMinimumVersion } from "./versions.ts";

/** What the c9s checks found. */
export interface C9sEnvironmentStatus {
  problems: string[];
  kubeContext?: string;
  kubernetesVersion?: string;
  clabernetesVersion?: string;
}

interface PermissionCheck extends KubeAccessCheck {
  /** How the problem names the permission, e.g. `pods/exec`. */
  label: string;
}

/**
 * The permissions a c9s lab host needs: create Topologies, exec into pods,
 * forward their ports and read their logs, and with a namespace per lab,
 * create namespaces.
 */
export function c9sPermissionChecks(namespace: string | undefined): PermissionCheck[] {
  const checks: PermissionCheck[] = [
    { label: "topologies.c9s.run", verb: "create", group: C9S_API_GROUP, resource: "topologies", namespace },
    { label: "pods/exec", verb: "create", resource: "pods", subresource: "exec", namespace },
    { label: "pods/portforward", verb: "create", resource: "pods", subresource: "portforward", namespace },
    { label: "pods/log", verb: "get", resource: "pods", subresource: "log", namespace }
  ];
  if (!namespace) checks.push({ label: "namespaces", verb: "create", resource: "namespaces" });
  return checks;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Checks a c9s lab host: the containerlab version, the kubeconfig context and
 * whether the cluster answers, clabernetes' Topology resource and version,
 * and the user's permissions. Each failure says what to do.
 */
export async function detectC9sEnvironment(
  options: Pick<ResolvedLocalOptions, "c9s" | "env">,
  containerlabVersion: string | undefined,
  createProbe: (options: Pick<ResolvedLocalOptions, "c9s" | "env">) => KubeClusterProbe = (resolved) =>
    createKubeClusterProbe(loadKubeConfig(resolved.c9s ?? {}, resolved.env))
): Promise<C9sEnvironmentStatus> {
  const problems: string[] = [];
  const status: C9sEnvironmentStatus = { problems };
  if (containerlabVersion && !meetsMinimumVersion(containerlabVersion, C9S_MIN_CONTAINERLAB_VERSION)) {
    problems.push(
      `This lab host needs containerlab ${C9S_MIN_CONTAINERLAB_VERSION} or later for c9s; ${containerlabVersion} is installed. Run: sudo containerlab version upgrade`
    );
  }

  let probe: KubeClusterProbe;
  try {
    probe = createProbe(options);
  } catch (error) {
    problems.push(message(error));
    return status;
  }
  status.kubeContext = probe.context;
  try {
    status.kubernetesVersion = await probe.serverVersion();
  } catch (error) {
    problems.push(`The cluster of context "${probe.context}" does not answer: ${message(error)}`);
    return status;
  }

  try {
    if (!(await probe.hasTopologyResource())) {
      problems.push(
        `clabernetes is not installed in the cluster of context "${probe.context}": it serves no topologies.${C9S_API_GROUP}. Install clabernetes ${C9S_MIN_CLABERNETES_VERSION} or later.`
      );
      return status;
    }
  } catch (error) {
    problems.push(`Could not look for clabernetes in context "${probe.context}": ${message(error)}`);
    return status;
  }

  try {
    const version = await probe.clabernetesVersion();
    if (version) {
      status.clabernetesVersion = version;
      if (!meetsMinimumVersion(version, C9S_MIN_CLABERNETES_VERSION)) {
        problems.push(
          `This lab host needs clabernetes ${C9S_MIN_CLABERNETES_VERSION} or later; the cluster runs ${version}. Upgrade clabernetes.`
        );
      }
    }
    // A user who may not read the manager learns the version from containerlab, which checks it too.
  } catch (error) {
    problems.push(`Could not read the clabernetes version in context "${probe.context}": ${message(error)}`);
  }

  const namespace = options.c9s?.namespace;
  const where = namespace ? `namespace ${namespace}` : "the cluster";
  const results = await Promise.all(
    c9sPermissionChecks(namespace).map((check) =>
      probe.canI(check).then(
        (allowed) => ({ check, allowed, error: undefined as string | undefined }),
        (error: unknown) => ({ check, allowed: false, error: message(error) })
      )
    )
  );
  for (const { check, allowed, error } of results) {
    if (error) {
      problems.push(`Could not check whether your account can ${check.verb} ${check.label}: ${error}`);
    } else if (!allowed) {
      problems.push(
        check.resource === "namespaces"
          ? `Your account cannot create namespaces, which a namespace per lab needs. Set the lab host's namespace to one you may use, or ask for namespace create rights.`
          : `Your account cannot ${check.verb} ${check.label} in ${where}. Bind clabernetes-lab-editor${namespace ? ` in ${namespace}` : ""}.`
      );
    }
  }
  return status;
}
