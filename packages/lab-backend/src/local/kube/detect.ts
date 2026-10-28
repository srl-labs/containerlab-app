import type { LabHostCheck } from "@containerlab/clab-ui/host";

import type { ResolvedLocalOptions } from "../options.ts";
import { createKubeClusterProbe, C9S_API_GROUP, type KubeAccessCheck, type KubeClusterProbe } from "./clusterProbe.ts";
import { loadKubeConfig } from "./kubeConfig.ts";
import { C9S_MIN_CLABERNETES_VERSION, C9S_MIN_CONTAINERLAB_VERSION, meetsMinimumVersion } from "./versions.ts";

/** What the c9s checks found. */
export interface C9sEnvironmentStatus {
  problems: string[];
  /** Every check in order, the ones after a failure that stops the rest as `skipped`. */
  checks: LabHostCheck[];
  kubeContext?: string;
  kubernetesVersion?: string;
  clabernetesVersion?: string;
}

interface PermissionCheck extends KubeAccessCheck {
  /** How the problem names the permission, e.g. `pods/exec`. */
  label: string;
}

/** The ClusterRole clabernetes installs for lab users. */
const LAB_EDITOR_ROLE = "clabernetes-lab-editor";

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

/** The `kubectl create … binding` subject of a Kubernetes user name. */
function bindingSubject(user: string | undefined): string {
  const serviceAccount = /^system:serviceaccount:([^:]+):([^:]+)$/.exec(user ?? "");
  if (serviceAccount) return `--serviceaccount ${serviceAccount[1]}:${serviceAccount[2]}`;
  return `--user ${user ?? "<your-user>"}`;
}

/** A binding name for a user: lowercase letters, digits and '-'. */
function bindingName(user: string | undefined): string {
  const suffix = (user ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return suffix ? `clab-lab-editor-${suffix}` : "clab-lab-editor";
}

/**
 * The command a cluster admin runs to give a user the lab editor role: in
 * the lab host's namespace, or in every namespace for a namespace per lab.
 */
function labEditorBindingCommand(namespace: string | undefined, user: string | undefined): string {
  return namespace
    ? `kubectl create rolebinding ${bindingName(user)} --clusterrole ${LAB_EDITOR_ROLE} ${bindingSubject(user)} -n ${namespace}`
    : `kubectl create clusterrolebinding ${bindingName(user)} --clusterrole ${LAB_EDITOR_ROLE} ${bindingSubject(user)}`;
}

/** The checks that did not run because an earlier one failed. */
function skipped(checks: Array<Pick<LabHostCheck, "id" | "label">>): LabHostCheck[] {
  return checks.map((check) => ({ ...check, status: "skipped", message: "Not checked: an earlier check failed." }));
}

const CLUSTER_CHECK = { id: "cluster", label: "The cluster answers" };
const CLABERNETES_CHECK = { id: "clabernetes", label: `clabernetes ${C9S_MIN_CLABERNETES_VERSION} or newer` };

function permissionCheckLabel(check: PermissionCheck, namespace: string | undefined): string {
  if (check.resource === "namespaces") return "May create namespaces (one per lab)";
  return `May ${check.verb} ${check.label} in ${namespace ? `namespace ${namespace}` : "lab namespaces"}`;
}

/** The checks of a c9s host that only run once its cluster answers. */
function laterChecks(namespace: string | undefined): Array<Pick<LabHostCheck, "id" | "label">> {
  return [
    CLABERNETES_CHECK,
    ...c9sPermissionChecks(namespace).map((check) => ({
      id: `access:${check.label}`,
      label: permissionCheckLabel(check, namespace)
    }))
  ];
}

/** The containerlab release check of a c9s host. */
export function containerlabCheck(version: string | undefined, problem?: string): LabHostCheck {
  const label = `containerlab ${C9S_MIN_CONTAINERLAB_VERSION} or newer`;
  if (version === undefined) {
    return { id: "containerlab", label, status: "failed", message: problem ?? "containerlab was not found." };
  }
  if (!meetsMinimumVersion(version, C9S_MIN_CONTAINERLAB_VERSION)) {
    return {
      id: "containerlab",
      label,
      status: "failed",
      message: `containerlab ${version} is installed.`,
      fix: "Upgrade containerlab.",
      command: "sudo containerlab version upgrade"
    };
  }
  const devBuild = /^v?0\.0\.0/.test(version.trim());
  return { id: "containerlab", label, status: "ok", message: `containerlab ${version}${devBuild ? " (development build)" : ""}` };
}

/**
 * Checks a c9s lab host: the containerlab version, the kubeconfig context and
 * whether the cluster answers, clabernetes' Topology resource and version,
 * and the user's permissions. Each failure says what to do. A failure that
 * makes the rest meaningless (no kubeconfig, no cluster, no clabernetes)
 * stops there; the checks after it are `skipped`.
 */
export async function detectC9sEnvironment(
  options: Pick<ResolvedLocalOptions, "c9s" | "env">,
  containerlabVersion: string | undefined,
  createProbe: (options: Pick<ResolvedLocalOptions, "c9s" | "env">) => KubeClusterProbe = (resolved) =>
    createKubeClusterProbe(loadKubeConfig(resolved.c9s ?? {}, resolved.env))
): Promise<C9sEnvironmentStatus> {
  const problems: string[] = [];
  const checks: LabHostCheck[] = [];
  const status: C9sEnvironmentStatus = { problems, checks };
  const namespace = options.c9s?.namespace;
  if (containerlabVersion) {
    const check = containerlabCheck(containerlabVersion);
    checks.push(check);
    if (check.status === "failed") {
      problems.push(
        `This lab host needs containerlab ${C9S_MIN_CONTAINERLAB_VERSION} or later for c9s; ${containerlabVersion} is installed. Run: sudo containerlab version upgrade`
      );
    }
  }

  const kubeconfigCheck = { id: "kubeconfig", label: "kubeconfig loads and has the context" };
  let probe: KubeClusterProbe;
  try {
    probe = createProbe(options);
  } catch (error) {
    problems.push(message(error));
    checks.push({
      ...kubeconfigCheck,
      status: "failed",
      message: message(error),
      fix: "Pick a context the kubeconfig has, or choose another kubeconfig file."
    });
    checks.push(...skipped([CLUSTER_CHECK, ...laterChecks(namespace)]));
    return status;
  }
  status.kubeContext = probe.context;
  checks.push({ ...kubeconfigCheck, status: "ok", message: `Context ${probe.context}` });

  try {
    status.kubernetesVersion = await probe.serverVersion();
    checks.push({ ...CLUSTER_CHECK, status: "ok", message: `Kubernetes ${status.kubernetesVersion}` });
  } catch (error) {
    problems.push(`The cluster of context "${probe.context}" does not answer: ${message(error)}`);
    checks.push({
      ...CLUSTER_CHECK,
      status: "failed",
      message: message(error),
      fix: "Make sure the cluster runs and this machine reaches its API server, e.g. with kubectl get nodes."
    });
    checks.push(...skipped(laterChecks(namespace)));
    return status;
  }

  const permissionsSkipped = () => skipped(laterChecks(namespace).slice(1));
  try {
    if (!(await probe.hasTopologyResource())) {
      problems.push(
        `clabernetes is not installed in the cluster of context "${probe.context}": it serves no topologies.${C9S_API_GROUP}. Install clabernetes ${C9S_MIN_CLABERNETES_VERSION} or later.`
      );
      checks.push({
        ...CLABERNETES_CHECK,
        status: "failed",
        message: `The cluster serves no topologies.${C9S_API_GROUP}: clabernetes is not installed.`,
        fix: `Install clabernetes ${C9S_MIN_CLABERNETES_VERSION} or later in the cluster.`
      });
      checks.push(...permissionsSkipped());
      return status;
    }
  } catch (error) {
    problems.push(`Could not look for clabernetes in context "${probe.context}": ${message(error)}`);
    checks.push({ ...CLABERNETES_CHECK, status: "failed", message: `Could not look for clabernetes: ${message(error)}` });
    checks.push(...permissionsSkipped());
    return status;
  }

  try {
    const version = await probe.clabernetesVersion();
    if (version) {
      status.clabernetesVersion = version;
      if (meetsMinimumVersion(version, C9S_MIN_CLABERNETES_VERSION)) {
        checks.push({ ...CLABERNETES_CHECK, status: "ok", message: `clabernetes ${version}` });
      } else {
        problems.push(
          `This lab host needs clabernetes ${C9S_MIN_CLABERNETES_VERSION} or later; the cluster runs ${version}. Upgrade clabernetes.`
        );
        checks.push({
          ...CLABERNETES_CHECK,
          status: "failed",
          message: `The cluster runs clabernetes ${version}.`,
          fix: `Upgrade clabernetes to ${C9S_MIN_CLABERNETES_VERSION} or later.`
        });
      }
    } else {
      // A user who may not read the manager learns the version from containerlab, which checks it too.
      checks.push({
        ...CLABERNETES_CHECK,
        status: "ok",
        message: "Installed; your account may not read its version, containerlab checks it on deploy."
      });
    }
  } catch (error) {
    problems.push(`Could not read the clabernetes version in context "${probe.context}": ${message(error)}`);
    checks.push({
      ...CLABERNETES_CHECK,
      status: "failed",
      message: `Could not read the clabernetes version: ${message(error)}`
    });
  }

  const where = namespace ? `namespace ${namespace}` : "the cluster";
  const permissions = c9sPermissionChecks(namespace);
  const [results, user] = await Promise.all([
    Promise.all(
      permissions.map((check) =>
        probe.canI(check).then(
          (allowed) => ({ check, allowed, error: undefined as string | undefined }),
          (error: unknown) => ({ check, allowed: false, error: message(error) })
        )
      )
    ),
    probe.whoAmI().catch(() => undefined)
  ]);
  for (const { check, allowed, error } of results) {
    const base = { id: `access:${check.label}`, label: permissionCheckLabel(check, namespace) };
    if (error) {
      problems.push(`Could not check whether your account can ${check.verb} ${check.label}: ${error}`);
      checks.push({ ...base, status: "failed", message: `Could not check: ${error}` });
    } else if (!allowed) {
      if (check.resource === "namespaces") {
        problems.push(
          `Your account cannot create namespaces, which a namespace per lab needs. Set the lab host's namespace to one you may use, or ask for namespace create rights.`
        );
        checks.push({
          ...base,
          status: "failed",
          message: `${user ?? "Your account"} cannot create namespaces.`,
          fix: "Use one fixed namespace on this lab host, or ask a cluster admin for the right to create namespaces."
        });
      } else {
        problems.push(
          `Your account cannot ${check.verb} ${check.label} in ${where}. Bind ${LAB_EDITOR_ROLE}${namespace ? ` in ${namespace}` : ""}.`
        );
        checks.push({
          ...base,
          status: "failed",
          message: `${user ?? "Your account"} cannot ${check.verb} ${check.label} in ${where}.`,
          fix: `A cluster admin binds ${LAB_EDITOR_ROLE} to you${namespace ? ` in ${namespace}` : " in every namespace"}:`,
          command: labEditorBindingCommand(namespace, user)
        });
      }
    } else {
      checks.push({ ...base, status: "ok", ...(user ? { message: `Allowed for ${user}` } : {}) });
    }
  }
  return status;
}
