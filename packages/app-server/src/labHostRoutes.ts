import type { FastifyInstance } from "fastify";

import type {
  ClusterHostSettings,
  KubeconfigContextsResponse,
  LabHostCheckResponse
} from "@srl-labs/containerlab-app-contract";
import {
  detectLocalEnvironment,
  readKubeContexts,
  type LocalLabBackendOptions
} from "@srl-labs/containerlab-lab-backend/local";

import type { LocalEndpointOptions } from "./app.ts";
import { clusterBackendOptions, localEndpointUrl, readClusterSettings } from "./localEndpointConfig.ts";

/** A local lab host of the app server, with its address. */
type LocalHost = LocalEndpointOptions & { url: string };

/**
 * How the app server keeps the Kubernetes clusters the user adds, edits and
 * removes in the app. Only for a single-user app on the user's own machine
 * (the desktop app): the routes read kubeconfig files of the server's user.
 */
export interface ClusterHostsOptions {
  /** The lab host of a cluster, built like the configured ones. */
  create(settings: ClusterHostSettings): LocalHost;
  /** Saves every cluster the user manages, e.g. as `clusters` in `local-backend.json`. */
  save(clusters: ClusterHostSettings[]): Promise<void>;
  /** The options every local lab host shares (binary, workspace), for checks of unsaved settings. */
  baseOptions?: LocalLabBackendOptions;
  /** The kubeconfig a cluster without its own file reads. */
  defaultKubeconfig?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Lab host routes:
 * - `POST /api/lab-hosts/check` `{url}`: the checks of a local lab host, looked at again.
 *
 * With `clusterHosts` (the desktop app) also:
 * - `GET /api/lab-hosts/kubeconfig/contexts?kubeconfig=`: the contexts of a kubeconfig file.
 * - `POST /api/lab-hosts/clusters/check` (settings): the checks of unsaved cluster settings.
 * - `POST /api/lab-hosts/clusters` `{settings, url?}`: adds a cluster, or replaces the one at `url`.
 * - `DELETE /api/lab-hosts/clusters?url=`: removes a cluster the user added.
 *
 * `locals` is the app server's list of local lab hosts; the cluster routes
 * change it in place, so every other route sees the change.
 */
export function registerLabHostRoutes(
  app: FastifyInstance,
  options: {
    locals: LocalHost[];
    clusterHosts?: ClusterHostsOptions;
  }
): void {
  const { locals, clusterHosts } = options;

  app.post<{ Body: { url?: unknown } }>("/api/lab-hosts/check", async (request, reply) => {
    const url = typeof request.body?.url === "string" ? request.body.url : "";
    const local = locals.find((candidate) => candidate.url === url);
    if (!local) return reply.status(404).send({ error: "This app has no such lab host." });
    const status = await local.status({ fresh: true });
    const response: LabHostCheckResponse = { available: status.available, checks: status.checks ?? [] };
    return reply.send(response);
  });

  if (!clusterHosts) return;

  const managed = () => locals.filter((local) => local.cluster !== undefined);

  app.get<{ Querystring: { kubeconfig?: string } }>("/api/lab-hosts/kubeconfig/contexts", async (request, reply) => {
    const kubeconfig = request.query.kubeconfig?.trim();
    const response: KubeconfigContextsResponse = readKubeContexts(kubeconfig ? { kubeconfig } : {});
    return reply.send(response);
  });

  app.post<{ Body: unknown }>("/api/lab-hosts/clusters/check", async (request, reply) => {
    const settings = readClusterSettings(request.body);
    if (typeof settings === "string") return reply.status(400).send({ error: settings });
    const environment = await detectLocalEnvironment({ ...clusterHosts.baseOptions, ...clusterBackendOptions(settings) });
    const response: LabHostCheckResponse = { available: environment.available, checks: environment.checks };
    return reply.send(response);
  });

  app.post<{ Body: { settings?: unknown; url?: unknown } }>("/api/lab-hosts/clusters", async (request, reply) => {
    const settings = readClusterSettings(request.body?.settings);
    if (typeof settings === "string") return reply.status(400).send({ error: settings });
    const previousUrl = typeof request.body?.url === "string" ? request.body.url : undefined;
    const previous = previousUrl === undefined ? undefined : managed().find((local) => local.url === previousUrl);
    if (previousUrl !== undefined && !previous) {
      return reply.status(404).send({ error: "This cluster is no longer in the app." });
    }
    const url = localEndpointUrl({ ...clusterHosts.baseOptions, ...clusterBackendOptions(settings) });
    const clash = locals.find((local) => local.url === url && local !== previous);
    if (clash) {
      return reply.status(409).send({ error: "This context of this kubeconfig is a lab host already." });
    }
    const next = managed().map((local) => (local === previous ? settings : (local.cluster as ClusterHostSettings)));
    if (!previous) next.push(settings);
    try {
      await clusterHosts.save(next);
    } catch (error) {
      return reply.status(500).send({ error: `The cluster could not be saved: ${errorMessage(error)}` });
    }
    const created = clusterHosts.create(settings);
    if (previous) {
      locals.splice(locals.indexOf(previous), 1, created);
      void previous.backend.dispose();
    } else {
      locals.push(created);
    }
    return reply.send({ url: created.url });
  });

  app.delete<{ Querystring: { url?: string } }>("/api/lab-hosts/clusters", async (request, reply) => {
    const local = managed().find((candidate) => candidate.url === request.query.url);
    if (!local) return reply.status(404).send({ error: "This cluster is no longer in the app." });
    try {
      await clusterHosts.save(managed().filter((candidate) => candidate !== local).map((candidate) => candidate.cluster as ClusterHostSettings));
    } catch (error) {
      return reply.status(500).send({ error: `The cluster could not be removed: ${errorMessage(error)}` });
    }
    locals.splice(locals.indexOf(local), 1);
    void local.backend.dispose();
    return reply.send({ success: true });
  });
}
