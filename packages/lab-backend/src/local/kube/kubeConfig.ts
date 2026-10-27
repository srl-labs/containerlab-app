import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { KubeConfig } from "@kubernetes/client-node";

import { LabBackendError } from "../../contract/errors.ts";
import { expandKubeconfigPath, type C9sHostOptions } from "../options.ts";

/**
 * The kubeconfig files a c9s host reads, like containerlab and kubectl find
 * them: the host's file, `CLAB_KUBECONFIG`, `KUBECONFIG` (a path list), then
 * `~/.kube/config`.
 */
export function kubeconfigFiles(c9s: Pick<C9sHostOptions, "kubeconfig">, env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME?.trim() || os.homedir();
  const configured = c9s.kubeconfig ?? env.CLAB_KUBECONFIG ?? env.KUBECONFIG;
  if (configured?.trim()) {
    return expandKubeconfigPath(configured, home)
      .split(path.delimiter)
      .map((file) => file.trim())
      .filter(Boolean);
  }
  return [path.join(home, ".kube", "config")];
}

/**
 * Loads the kubeconfig of a c9s host and selects its context. Without a
 * kubeconfig file, a pod uses its ServiceAccount. Exec credential plugins
 * (GKE, EKS, OIDC) run through client-node when a request needs a token.
 */
export function loadKubeConfig(c9s: C9sHostOptions, env: NodeJS.ProcessEnv): KubeConfig {
  const config = new KubeConfig();
  const files = kubeconfigFiles(c9s, env).filter((file) => fs.existsSync(file));
  if (files.length === 0) {
    if (env.KUBERNETES_SERVICE_HOST && !c9s.kubeContext) {
      config.loadFromCluster();
      return config;
    }
    throw new LabBackendError(
      `No kubeconfig found (looked at ${kubeconfigFiles(c9s, env).join(", ")}). Set the lab host's kubeconfig or KUBECONFIG.`,
      503
    );
  }
  try {
    config.loadFromFile(files[0]);
    for (const file of files.slice(1)) {
      const next = new KubeConfig();
      next.loadFromFile(file);
      config.mergeConfig(next, true);
    }
  } catch (error) {
    throw new LabBackendError(
      `The kubeconfig ${files.join(path.delimiter)} does not load: ${error instanceof Error ? error.message : String(error)}`,
      503,
      { cause: error }
    );
  }
  if (c9s.kubeContext) {
    if (!config.getContextObject(c9s.kubeContext)) {
      throw new LabBackendError(
        `The kubeconfig has no context "${c9s.kubeContext}". Pick one of: ${
          config.getContexts().map((context) => context.name).join(", ") || "none"
        }.`,
        503
      );
    }
    config.setCurrentContext(c9s.kubeContext);
  } else if (!config.getCurrentContext()) {
    throw new LabBackendError("The kubeconfig has no current context. Set the lab host's context.", 503);
  }
  return config;
}

/** A kubeconfig context a user can pick for a lab host. */
export interface KubeContextInfo {
  name: string;
  cluster: string;
  namespace?: string;
  current: boolean;
}

/** The contexts of the kubeconfig, for "Add lab host"; empty when there is none. */
export function listKubeContexts(
  c9s: Pick<C9sHostOptions, "kubeconfig"> = {},
  env: NodeJS.ProcessEnv = process.env
): KubeContextInfo[] {
  let config: KubeConfig;
  try {
    config = loadKubeConfig({ ...c9s, kubeContext: undefined }, { ...env, KUBERNETES_SERVICE_HOST: "" });
  } catch {
    return [];
  }
  const current = config.getCurrentContext();
  return config.getContexts().map((context) => ({
    name: context.name,
    cluster: context.cluster,
    ...(context.namespace ? { namespace: context.namespace } : {}),
    current: context.name === current
  }));
}
