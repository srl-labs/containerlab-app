import type { TopologyRef } from "@srl-labs/clab-ui/session";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type {
  ClabApiClient,
  InspectContainerInfo,
  NetemResetRequest,
  NetemSetRequest,
  TerminalProtocol
} from "./clabApiClient.js";
import { getTokenFromRequest } from "./middleware.js";
import {
  buildStandaloneTopologyRef,
  resolveCanonicalStandaloneTopologyRef
} from "./topologyIdentity.js";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.js";

interface RuntimeTargetBody {
  sessionId?: string;
  topologyRef?: TopologyRef;
}

interface SaveBody extends RuntimeTargetBody {
  nodeName?: string;
}

interface NodeBody extends RuntimeTargetBody {
  nodeName: string;
  duration?: string;
  sshUsername?: string;
  tail?: string;
}

interface TerminalBody extends RuntimeTargetBody {
  nodeName: string;
  protocol: TerminalProtocol;
  cols?: number;
  rows?: number;
  sshUsername?: string;
  telnetPort?: number;
}

interface NetemBody extends RuntimeTargetBody {
  nodeName: string;
  interfaceName?: string;
  delay?: string;
  jitter?: string;
  loss?: number;
  rate?: number;
  corruption?: number;
}

interface CreateTopologyFileBody {
  content?: string;
  fileName: string;
}

interface UiCustomNodeDefaultBody {
  name: string;
}

interface UiIconUploadBody {
  fileName: string;
  contentType?: string;
  dataBase64: string;
}

interface UiIconListBody extends RuntimeTargetBody {}

interface UiIconReconcileBody extends RuntimeTargetBody {
  usedIcons?: string[];
}

type ClientResolver = (request: FastifyRequest) => ClabApiClient;

interface ResolvedLabTarget {
  labName: string;
  topologyRef?: TopologyRef;
  yamlPath?: string;
}

class RequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
  }
}

function handleRouteError(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RequestError) {
    return reply.status(error.statusCode).send({ error: message });
  }
  return reply.status(500).send({ error: message });
}

async function resolveLabTarget(
  request: FastifyRequest,
  token: string,
  client: ClabApiClient,
  sessions: StandaloneTopologySessionManager,
  target: RuntimeTargetBody
): Promise<ResolvedLabTarget> {
  const sessionId = target.sessionId?.trim() ?? "";
  if (sessionId) {
    const session = sessions.getSession(sessionId, token, client.getBaseUrl());
    if (!session) {
      throw new RequestError("Topology session not found", 404);
    }
    return {
      labName: session.topologyRef.labName,
      topologyRef: session.topologyRef,
      yamlPath: session.topologyRef.yamlPath
    };
  }

  if (target.topologyRef) {
    const topologyRef = await resolveCanonicalStandaloneTopologyRef(client, token, target.topologyRef);
    return {
      labName: topologyRef.labName,
      topologyRef,
      yamlPath: topologyRef.yamlPath
    };
  }

  throw new RequestError("Missing topologyRef or sessionId", 400);
}

function stripContainerPrefix(labName: string, containerName: string): string {
  const prefix = `clab-${labName}-`;
  return containerName.startsWith(prefix) ? containerName.slice(prefix.length) : containerName;
}

function scoreNodeMatch(labName: string, containerName: string, requestedNodeName: string): number {
  const normalizedContainer = containerName.trim().toLowerCase();
  const normalizedRequested = requestedNodeName.trim().toLowerCase();
  if (!normalizedRequested || !normalizedContainer) {
    return 0;
  }
  if (normalizedContainer === normalizedRequested) {
    return 100;
  }

  const shortName = stripContainerPrefix(labName.trim().toLowerCase(), normalizedContainer);
  if (shortName === normalizedRequested) {
    return 90;
  }
  if (shortName.startsWith(`${normalizedRequested}-`)) {
    return 80;
  }
  if (normalizedContainer.endsWith(`-${normalizedRequested}`)) {
    return 70;
  }

  return 0;
}

async function resolveNodeTarget(
  client: ClabApiClient,
  token: string,
  labName: string,
  requestedNodeName: string
): Promise<{ container: InspectContainerInfo; nodeFilter: string }> {
  const nodeName = requestedNodeName.trim();
  if (!nodeName) {
    throw new RequestError("Missing nodeName", 400);
  }

  const containers = await client.inspectLab(token, labName);
  let bestMatch: InspectContainerInfo | null = null;
  let bestScore = 0;

  for (const container of containers) {
    const score = scoreNodeMatch(labName, container.name, nodeName);
    if (score > bestScore) {
      bestMatch = container;
      bestScore = score;
    }
  }

  if (!bestMatch || bestScore === 0) {
    throw new RequestError(`Node "${nodeName}" was not found in lab "${labName}".`, 404);
  }

  return {
    container: bestMatch,
    nodeFilter: stripContainerPrefix(labName, bestMatch.name)
  };
}

function parseOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeOptionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function stripTopologySuffix(name: string): string {
  return name.replace(/\.clab\.(ya?ml)$/i, "");
}

function validateTopologyFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new RequestError("File name is required", 400);
  }
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    throw new RequestError("File name must not include path separators", 400);
  }
  if (!/\.clab\.(yml|yaml)$/i.test(trimmed)) {
    throw new RequestError("File name must end with .clab.yml or .clab.yaml", 400);
  }
  return trimmed;
}

function buildDefaultTopologyContent(labName: string): string {
  return `name: ${labName}\ntopology:\n  nodes: {}\n`;
}

export function registerRuntimeProxy(
  app: FastifyInstance,
  getClient: ClientResolver,
  sessions: StandaloneTopologySessionManager
): void {
  app.get("/api/runtime/inspect/all", async (request, reply) => {
    const token = getTokenFromRequest(request);
    if (!token) return reply.status(401).send({ error: "Not authenticated" });

    try {
      const client = getClient(request);
      const labs = await client.listLabs(token);
      return reply.send(labs);
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post<{ Body: RuntimeTargetBody }>(
    "/api/runtime/inspect/lab",
    async (request: FastifyRequest<{ Body: RuntimeTargetBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const lab = await client.inspectLab(token, target.labName);
        return reply.send(lab);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: SaveBody }>(
    "/api/runtime/save",
    async (request: FastifyRequest<{ Body: SaveBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        let nodeFilter: string | undefined;

        if (typeof request.body.nodeName === "string" && request.body.nodeName.trim().length > 0) {
          const resolvedNode = await resolveNodeTarget(
            client,
            token,
            target.labName,
            request.body.nodeName
          );
          nodeFilter = resolvedNode.nodeFilter;
        }

        const result = await client.saveLab(token, target.labName, { nodeFilter });
        return reply.send(result);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: NodeBody }>(
    "/api/runtime/ssh",
    async (request: FastifyRequest<{ Body: NodeBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(client, token, target.labName, request.body.nodeName);
        const sshAccess = await client.requestSshAccess(token, target.labName, resolvedNode.container.name, {
          duration: normalizeOptionalString(request.body.duration),
          sshUsername: normalizeOptionalString(request.body.sshUsername)
        });
        return reply.send(sshAccess);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: NodeBody }>(
    "/api/runtime/logs",
    async (request: FastifyRequest<{ Body: NodeBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(client, token, target.labName, request.body.nodeName);
        const logs = await client.getNodeLogs(token, target.labName, resolvedNode.container.name, {
          tail: normalizeOptionalString(request.body.tail) ?? "200"
        });
        return reply.send(logs);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: TerminalBody }>(
    "/api/runtime/terminal-sessions",
    async (request: FastifyRequest<{ Body: TerminalBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(client, token, target.labName, request.body.nodeName);
        const session = await client.createTerminalSession(token, target.labName, resolvedNode.container.name, {
          protocol: request.body.protocol,
          cols: normalizeOptionalInteger(request.body.cols) ?? 120,
          rows: normalizeOptionalInteger(request.body.rows) ?? 36,
          sshUsername: normalizeOptionalString(request.body.sshUsername),
          telnetPort: normalizeOptionalInteger(request.body.telnetPort)
        });
        return reply.send(session);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/runtime/terminal-sessions/:sessionId",
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const session = await client.getTerminalSession(token, request.params.sessionId);
        return reply.send(session);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.delete<{ Params: { sessionId: string } }>(
    "/api/runtime/terminal-sessions/:sessionId",
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        await client.deleteTerminalSession(token, request.params.sessionId);
        return reply.send({ success: true });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: NetemBody }>(
    "/api/runtime/netem/show",
    async (request: FastifyRequest<{ Body: NetemBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(client, token, target.labName, request.body.nodeName);
        const impairments = await client.showNetem(token, resolvedNode.container.name);
        return reply.send({
          containerName: resolvedNode.container.name,
          impairments
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: NetemBody }>(
    "/api/runtime/netem/set",
    async (request: FastifyRequest<{ Body: NetemBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const interfaceName = normalizeOptionalString(request.body.interfaceName);
        if (!interfaceName) {
          throw new RequestError("Missing interfaceName", 400);
        }

        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(client, token, target.labName, request.body.nodeName);
        const netemRequest: NetemSetRequest = {
          containerName: resolvedNode.container.name,
          interface: interfaceName,
          delay: normalizeOptionalString(request.body.delay),
          jitter: normalizeOptionalString(request.body.jitter),
          loss: parseOptionalNumber(request.body.loss),
          rate: parseOptionalNumber(request.body.rate),
          corruption: parseOptionalNumber(request.body.corruption)
        };
        await client.setNetem(token, netemRequest);
        return reply.send({ success: true });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: NetemBody }>(
    "/api/runtime/netem/reset",
    async (request: FastifyRequest<{ Body: NetemBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const interfaceName = normalizeOptionalString(request.body.interfaceName);
        if (!interfaceName) {
          throw new RequestError("Missing interfaceName", 400);
        }

        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const resolvedNode = await resolveNodeTarget(client, token, target.labName, request.body.nodeName);
        const netemRequest: NetemResetRequest = {
          containerName: resolvedNode.container.name,
          interface: interfaceName
        };
        await client.resetNetem(token, netemRequest);
        return reply.send({ success: true });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.get("/api/runtime/version", async (request, reply) => {
    const token = getTokenFromRequest(request);
    if (!token) return reply.status(401).send({ error: "Not authenticated" });

    try {
      const client = getClient(request);
      return reply.send(await client.getVersion(token));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/runtime/version/check", async (request, reply) => {
    const token = getTokenFromRequest(request);
    if (!token) return reply.status(401).send({ error: "Not authenticated" });

    try {
      const client = getClient(request);
      return reply.send(await client.checkVersion(token));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get("/api/runtime/ui/custom-nodes", async (request, reply) => {
    const token = getTokenFromRequest(request);
    if (!token) return reply.status(401).send({ error: "Not authenticated" });

    try {
      const client = getClient(request);
      return reply.send(await client.getCustomNodes(token));
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.post<{ Body: Record<string, unknown> }>(
    "/api/runtime/ui/custom-nodes",
    async (request: FastifyRequest<{ Body: Record<string, unknown> }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        return reply.send(await client.saveCustomNode(token, request.body));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.delete<{ Params: { name: string } }>(
    "/api/runtime/ui/custom-nodes/:name",
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        return reply.send(await client.deleteCustomNode(token, request.params.name));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: UiCustomNodeDefaultBody }>(
    "/api/runtime/ui/custom-nodes/default",
    async (request: FastifyRequest<{ Body: UiCustomNodeDefaultBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const name = normalizeOptionalString(request.body.name);
        if (!name) {
          throw new RequestError("Missing custom node name", 400);
        }
        return reply.send(await client.setDefaultCustomNode(token, name));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: UiIconListBody }>(
    "/api/runtime/ui/icons/list",
    async (request: FastifyRequest<{ Body: UiIconListBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        return reply.send(await client.listLabIcons(token, target.labName));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: UiIconUploadBody }>(
    "/api/runtime/ui/icons",
    async (request: FastifyRequest<{ Body: UiIconUploadBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        return reply.send(await client.uploadGlobalIcon(token, request.body));
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.delete<{ Params: { iconName: string } }>(
    "/api/runtime/ui/icons/:iconName",
    async (request: FastifyRequest<{ Params: { iconName: string } }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        await client.deleteGlobalIcon(token, request.params.iconName);
        return reply.send({ success: true });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: UiIconReconcileBody }>(
    "/api/runtime/ui/icons/reconcile",
    async (request: FastifyRequest<{ Body: UiIconReconcileBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        const usedIcons = Array.isArray(request.body.usedIcons)
          ? request.body.usedIcons.filter((value): value is string => typeof value === "string")
          : [];
        await client.reconcileLabIcons(token, target.labName, usedIcons);
        return reply.send({ success: true });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: CreateTopologyFileBody }>(
    "/api/runtime/topology-file/create",
    async (request: FastifyRequest<{ Body: CreateTopologyFileBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const fileName = validateTopologyFileName(request.body.fileName);
        const labName = stripTopologySuffix(fileName);
        if (await client.headFile(token, labName, fileName)) {
          throw new RequestError(`Topology file "${fileName}" already exists.`, 409);
        }

        const content =
          normalizeOptionalString(request.body.content) ?? buildDefaultTopologyContent(labName);
        await client.putFile(token, labName, fileName, content);

        const topologies = await client.listTopologies(token);
        const topologyEntry = topologies.find(
          (entry) => entry.labName === labName && entry.yamlFileName === fileName
        );

        return reply.send({
          success: true,
          topologyRef: topologyEntry
            ? buildStandaloneTopologyRef(topologyEntry)
            : {
                topologyId: `standalone:${fileName}`,
                labName,
                yamlPath: fileName,
                annotationsPath: `${fileName}.annotations.json`,
                source: "standalone"
              }
        });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  app.post<{ Body: RuntimeTargetBody }>(
    "/api/runtime/topology-file/delete",
    async (request: FastifyRequest<{ Body: RuntimeTargetBody }>, reply: FastifyReply) => {
      const token = getTokenFromRequest(request);
      if (!token) return reply.status(401).send({ error: "Not authenticated" });

      try {
        const client = getClient(request);
        const target = await resolveLabTarget(request, token, client, sessions, request.body);
        if (!target.yamlPath) {
          throw new RequestError("Missing topology file path", 400);
        }
        await client.deleteFile(token, target.labName, target.yamlPath);
        return reply.send({ success: true, path: target.yamlPath });
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );
}
