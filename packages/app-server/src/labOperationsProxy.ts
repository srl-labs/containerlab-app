import {
  isValidLabActionPath,
  isValidLabelFilter,
  type LabHostScriptEvent,
  type LabHostScriptRequest,
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
import { streamResponseHeaders } from "./streamResponseHeaders.ts";
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

interface HostScriptBody extends RuntimeTargetBody {
  scriptPath?: unknown;
  script?: unknown;
  timeoutSeconds?: unknown;
}

/** One day; a script that needs longer can run without a limit. */
const MAX_SCRIPT_TIMEOUT_SECONDS = 24 * 60 * 60;
const MAX_SCRIPT_CHARS = 256 * 1024;

/** The lab and, when known, its topology file, so scripts run from the topology folder. */
function toLabTarget(target: { labName: string; yamlPath?: string }): { labName: string; path?: string } {
  return target.yamlPath !== undefined && target.yamlPath !== ""
    ? { labName: target.labName, path: target.yamlPath }
    : { labName: target.labName };
}

/** A host script request from the browser, checked before it reaches the lab host. */
function parseHostScriptBody(body: Partial<HostScriptBody>): LabHostScriptRequest {
  const scriptPath = typeof body.scriptPath === "string" ? body.scriptPath.trim() : "";
  const script = typeof body.script === "string" ? body.script : "";
  if (!scriptPath && !script.trim()) throw new RequestError("Script or scriptPath is required", 400);
  if (script.length > MAX_SCRIPT_CHARS) throw new RequestError("Script is too long", 400);
  const value = body.timeoutSeconds;
  if (value === undefined || value === null) return scriptPath ? { scriptPath } : { script };
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_SCRIPT_TIMEOUT_SECONDS) {
    throw new RequestError("Invalid timeoutSeconds", 400);
  }
  return { ...(scriptPath ? { scriptPath } : { script }), timeoutSeconds: value };
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
    run: (
      backend: LabBackend,
      labName: string,
      body: Partial<Body>,
      target: { labName: string; path?: string }
    ) => Promise<unknown>
  ): Promise<FastifyReply> {
    const body: Partial<Body> = request.body ?? {};
    const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(body));
    if (!resolved) return reply.status(401).send({ error: "Not authenticated" });
    try {
      const target = await resolveLabTarget(resolved.endpoint, resolved.backend, sessions, body);
      return reply.send(await run(resolved.backend, target.labName, body, toLabTarget(target)));
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

  app.post<{ Body: HostScriptBody }>("/api/runtime/lab-operations/host-script", (request, reply) =>
    withLab(request, reply, async (backend, _labName, body, target) =>
      backend.runHostScript(target, parseHostScriptBody(body))
    )
  );

  // The same script as NDJSON: output events as they come, then the exit event.
  app.post<{ Body: HostScriptBody }>(
    "/api/runtime/lab-operations/host-script/stream",
    async (request, reply) => {
      const body: Partial<HostScriptBody> = request.body ?? {};
      const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(body));
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });
      let events: AsyncIterable<LabHostScriptEvent>;
      try {
        const script = parseHostScriptBody(body);
        const target = await resolveLabTarget(resolved.endpoint, resolved.backend, sessions, body);
        events = await resolved.backend.streamHostScript(toLabTarget(target), script);
      } catch (error) {
        return handleRouteError(reply, error);
      }
      reply.hijack();
      reply.raw.writeHead(
        200,
        streamResponseHeaders(request, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff"
        })
      );
      const iterator = events[Symbol.asyncIterator]();
      // A closed connection ends the iteration, which stops the script.
      reply.raw.on("close", () => void iterator.return?.());
      try {
        for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
          if (reply.raw.destroyed) break;
          reply.raw.write(`${JSON.stringify(next.value)}\n`);
        }
      } catch (error) {
        if (!reply.raw.destroyed) {
          reply.raw.write(`${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : String(error) })}\n`);
        }
      } finally {
        if (!reply.raw.writableEnded) reply.raw.end();
      }
      return reply;
    }
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
