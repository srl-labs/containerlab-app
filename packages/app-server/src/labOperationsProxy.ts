import {
  isValidLabActionPath,
  isValidLabelFilter,
  type TopoViewerNodesAction
} from "@containerlab/clab-ui/host";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LabBackend } from "@srl-labs/containerlab-lab-backend";

import type { EndpointResolver } from "./endpointResolver.ts";
import {
  handleRouteError,
  RequestError,
  resolveLabTarget,
  resolveNodeTarget,
  resolveRequestedEndpointId,
  type RuntimeTargetBody
} from "./runtimeProxy.ts";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.ts";

interface NodesBody extends RuntimeTargetBody {
  nodeNames?: unknown;
}

interface ExecBody extends NodesBody {
  command?: unknown;
  labels?: unknown;
}

interface SnapshotsBody extends NodesBody {
  outputDir?: unknown;
  timeout?: unknown;
}

interface SaveBody extends NodesBody {
  copyDir?: unknown;
}

const MAX_NODES = 512;
const DURATION_PATTERN = /^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/;

function stringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new RequestError(`${field} must be a list of strings`, 400);
  }
  const list = Array.from(new Set((value as string[]).map((entry) => entry.trim()).filter(Boolean)));
  if (list.length > MAX_NODES) throw new RequestError(`Too many ${field}`, 400);
  return list;
}

function optionalPath(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return undefined;
  if (!isValidLabActionPath(trimmed)) throw new RequestError(`Invalid ${field}`, 400);
  return trimmed;
}

/** Topology node names as the lab host knows them, from names the canvas shows. */
async function resolveNodeNames(backend: LabBackend, labName: string, value: unknown): Promise<string[]> {
  const requested = stringList(value, "nodeNames");
  const resolved = await Promise.all(
    requested.map(async (name) => (await resolveNodeTarget(backend, labName, name)).nodeFilter)
  );
  return Array.from(new Set(resolved));
}

function normalizeNodesAction(value: string): TopoViewerNodesAction | undefined {
  return value === "start" || value === "stop" || value === "restart" ? value : undefined;
}

/**
 * Exec, VM snapshots, config save with copy, inspect details and multi-node
 * start/stop/restart for the lab of a topology session or reference.
 */
export function registerLabOperationsProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
  sessions: StandaloneTopologySessionManager
): void {
  async function withLab<Body extends RuntimeTargetBody>(
    request: FastifyRequest<{ Body: Body }>,
    reply: FastifyReply,
    run: (backend: LabBackend, labName: string, body: Partial<Body>, path?: string) => Promise<unknown>
  ): Promise<FastifyReply> {
    const body: Partial<Body> = request.body ?? {};
    const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(body));
    if (!resolved) return reply.status(401).send({ error: "Not authenticated" });
    try {
      const target = await resolveLabTarget(resolved.endpoint, resolved.backend, sessions, body);
      return reply.send(await run(resolved.backend, target.labName, body, target.yamlPath));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  }

  app.post<{ Body: RuntimeTargetBody }>("/api/runtime/lab-operations/support", async (request, reply) => {
    const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(request.body ?? {}));
    if (!resolved) return reply.status(401).send({ error: "Not authenticated" });
    try {
      return reply.send(await resolved.backend.labOperationSupport());
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post<{ Body: ExecBody }>("/api/runtime/lab-operations/exec", (request, reply) =>
    withLab(request, reply, async (backend, labName, body) => {
      const command = typeof body.command === "string" ? body.command.trim() : "";
      if (!command) throw new RequestError("Command cannot be empty", 400);
      const labels = stringList(body.labels, "labels");
      const invalid = labels.find((label) => !isValidLabelFilter(label));
      if (invalid !== undefined) throw new RequestError(`Invalid label filter '${invalid}'`, 400);
      const nodeNames = await resolveNodeNames(backend, labName, body.nodeNames);
      return backend.exec({ labName }, { command, nodeNames, labels });
    })
  );

  app.post<{ Body: SnapshotsBody }>("/api/runtime/lab-operations/snapshots", (request, reply) =>
    withLab(request, reply, async (backend, labName, body) => {
      const timeout = typeof body.timeout === "string" ? body.timeout.trim() : "";
      if (timeout && !DURATION_PATTERN.test(timeout)) throw new RequestError("Invalid timeout", 400);
      const nodeNames = await resolveNodeNames(backend, labName, body.nodeNames);
      const outputDir = optionalPath(body.outputDir, "outputDir");
      return backend.saveSnapshots(
        { labName },
        {
          ...(nodeNames.length > 0 ? { nodeNames } : {}),
          ...(outputDir ? { outputDir } : {}),
          ...(timeout ? { timeout } : {})
        }
      );
    })
  );

  app.post<{ Body: SaveBody }>("/api/runtime/lab-operations/save", (request, reply) =>
    withLab(request, reply, async (backend, labName, body) => {
      const nodeNames = await resolveNodeNames(backend, labName, body.nodeNames);
      const copyDir = optionalPath(body.copyDir, "copyDir");
      return backend.save(
        { labName },
        {
          ...(nodeNames.length > 0 ? { nodeFilter: nodeNames.join(",") } : {}),
          ...(copyDir ? { copyDir } : {})
        }
      );
    })
  );

  app.post<{ Body: RuntimeTargetBody }>("/api/runtime/lab-operations/inspect-details", (request, reply) =>
    withLab(request, reply, (backend, labName) => backend.inspectLabDetails({ labName }))
  );

  // Where the nodes of a running lab are: on c9s their namespace, pod and exposed ports.
  app.post<{ Body: RuntimeTargetBody }>("/api/runtime/lab-operations/node-locations", (request, reply) =>
    withLab(request, reply, (backend, labName) => backend.inspectLab(labName))
  );

  app.post<{ Body: RuntimeTargetBody }>("/api/runtime/lab-operations/manifests", (request, reply) =>
    withLab(request, reply, (backend, labName, _body, path) =>
      backend.exportManifests({ labName, ...(path ? { path } : {}) })
    )
  );

  app.post<{ Body: RuntimeTargetBody }>("/api/runtime/lab-operations/validate", (request, reply) =>
    withLab(request, reply, (backend, labName, _body, path) =>
      backend.validate({ labName, ...(path ? { path } : {}) })
    )
  );

  app.post<{ Params: { action: string }; Body: NodesBody }>(
    "/api/runtime/lab-operations/nodes/:action",
    (request, reply) => {
      const action = normalizeNodesAction(request.params.action);
      if (!action) return reply.status(400).send({ error: "Invalid node lifecycle action." });
      return withLab(request, reply, async (backend, labName, body) => {
        const nodeNames = await resolveNodeNames(backend, labName, body.nodeNames);
        if (nodeNames.length === 0) throw new RequestError("Choose at least one node", 400);
        return backend.nodesAction({ labName }, nodeNames, action);
      });
    }
  );
}
