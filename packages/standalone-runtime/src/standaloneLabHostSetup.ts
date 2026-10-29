// Lab host setup through the app server: checks, and the Kubernetes clusters the desktop app manages.
import type {
  ClusterHostSettings,
  KubeconfigContextsResponse,
  LabHostCheck,
  LabHostCheckResponse
} from "@srl-labs/containerlab-app-contract";

import { runtimeFetch } from "./backend";
import { standaloneServerUrl } from "./standaloneServerOrigin";

async function send<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await runtimeFetch(standaloneServerUrl(path), {
    credentials: "include",
    ...init,
    headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" && payload.error ? payload.error : `Request failed (${response.status})`);
  }
  return payload as T;
}

/** The checks of a lab host on the app's machine, looked at again ("Check connection"). */
export async function checkLocalLabHost(url: string): Promise<LabHostCheck[]> {
  const result = await send<LabHostCheckResponse>("/api/lab-hosts/check", {
    method: "POST",
    body: JSON.stringify({ url })
  });
  return result.checks;
}

/** The contexts of a kubeconfig on the app's machine; of the default one without a file. */
export function kubeconfigContexts(kubeconfig?: string): Promise<KubeconfigContextsResponse> {
  const query = kubeconfig ? `?kubeconfig=${encodeURIComponent(kubeconfig)}` : "";
  return send<KubeconfigContextsResponse>(`/api/lab-hosts/kubeconfig/contexts${query}`);
}

/** The checks of cluster settings that are not saved yet. */
export async function checkClusterSettings(settings: ClusterHostSettings): Promise<LabHostCheck[]> {
  const result = await send<LabHostCheckResponse>("/api/lab-hosts/clusters/check", {
    method: "POST",
    body: JSON.stringify(settings)
  });
  return result.checks;
}

/** Saves a cluster, or replaces the one at `url`; answers with the cluster's address. */
export async function saveCluster(settings: ClusterHostSettings, url?: string): Promise<string> {
  const result = await send<{ url: string }>("/api/lab-hosts/clusters", {
    method: "POST",
    body: JSON.stringify({ settings, ...(url !== undefined ? { url } : {}) })
  });
  return result.url;
}

/** Removes a cluster the user added in the app. */
export async function deleteCluster(url: string): Promise<void> {
  await send(`/api/lab-hosts/clusters?url=${encodeURIComponent(url)}`, { method: "DELETE" });
}
