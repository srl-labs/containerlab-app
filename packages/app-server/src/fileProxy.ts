/**
 * File listing proxy - returns topology files in the format the Explorer expects.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { topologyFileStem } from "@containerlab/clab-ui/host";
import { runDocumentOperation } from "@containerlab/clab-ui/session";
import { errorStatus, type LabBackend, type WorkspaceFileEntry } from "@srl-labs/containerlab-lab-backend";
import { getHttpErrorStatus } from "@srl-labs/containerlab-lab-backend/api";

import type { EndpointResolver, ResolvedEndpoint } from "./endpointResolver.ts";
import { getEndpointIdFromRequest } from "./middleware.ts";
import {
  EventStreamRefusal,
  sendSseEventStream,
  type EventStreamSource,
} from "./eventStreams.ts";
import { buildStandaloneTopologyRef } from "./topologyIdentity.ts";

interface WorkspaceFileExplorerEntry extends WorkspaceFileEntry {
  endpointId: string;
  topologyRef?: ReturnType<typeof buildStandaloneTopologyRef>;
  labName?: string;
  deploymentState?: string;
}

const MAX_TEXT_FILE_BYTES = 1024 * 1024;

function queryString(request: FastifyRequest, key: string): string {
  const query = request.query as Record<string, unknown> | undefined;
  const value = query?.[key];
  return typeof value === "string" ? value : "";
}

function bodyRecord(request: FastifyRequest): Record<string, unknown> {
  return typeof request.body === "object" && request.body !== null
    ? (request.body as Record<string, unknown>)
    : {};
}

function bodyString(request: FastifyRequest, key: string): string {
  const value = bodyRecord(request)[key];
  return typeof value === "string" ? value : "";
}

function sendProxyError(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : String(error);
  return reply.status(getHttpErrorStatus(error) ?? 500).send({ error: message });
}

async function readTextFile(backend: LabBackend, pathValue: string): Promise<string> {
  const { data } = await backend.fs.read(pathValue, { maxBytes: MAX_TEXT_FILE_BYTES });
  return new TextDecoder().decode(data);
}

function resolveFileEndpoint(
  request: FastifyRequest,
  reply: FastifyReply,
  resolveEndpoint: EndpointResolver,
): ResolvedEndpoint | null {
  return resolveEndpoint(request, reply, getEndpointIdFromRequest(request));
}

/** Changes to the files of an endpoint's workspace. */
export function workspaceFileEventStreams(resolveEndpoint: EndpointResolver): EventStreamSource {
  return (request, reply, params) => {
    const resolved = resolveEndpoint(request, reply, params.endpointId);
    if (!resolved) {
      throw new EventStreamRefusal(401, "Not authenticated");
    }

    const { backend } = resolved;
    return {
      failureMessage: "Workspace event stream error",
      async open(signal) {
        const events = await backend.fs.watch(signal);
        return (async function* () {
          for await (const event of events) yield JSON.stringify(event);
        })();
      },
    };
  };
}

export function registerFileProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
): void {
  app.get("/files", async (request, reply) => {
    const resolved = resolveEndpoint(request, reply);
    if (!resolved) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    try {
      const { backend, endpoint } = resolved;
      const topologies = await backend.listTopologies();
      // Transform to the format expected by the Explorer bridge.
      return reply.send(
        topologies.map((topo) => {
          const topologyRef = buildStandaloneTopologyRef(topo, endpoint.id);
          return {
            endpointId: endpoint.id,
            filename: topo.yamlFileName,
            path: topologyRef.yamlPath,
            hasAnnotations: topo.hasAnnotations,
            labName: topo.labName,
            deploymentState: topo.deploymentState || "unknown",
            topologyRef,
          };
        }),
      );
    } catch (error) {
      return sendProxyError(reply, error);
    }
  });

  app.get("/api/runtime/file-explorer/tree", async (request, reply) => {
    const resolved = resolveFileEndpoint(request, reply, resolveEndpoint);
    if (!resolved) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    try {
      const { backend, endpoint } = resolved;
      const entries = await backend.fs.list(queryString(request, "path"));
      return reply.send(
        entries.map((entry): WorkspaceFileExplorerEntry => {
          const visibleEntry: WorkspaceFileEntry = { ...entry };
          delete visibleEntry.size;
          delete visibleEntry.modifiedAt;
          return {
            ...visibleEntry,
            endpointId: endpoint.id,
          };
        }),
      );
    } catch (error) {
      return sendProxyError(reply, error);
    }
  });

  const fileEvents = workspaceFileEventStreams(resolveEndpoint);
  app.get("/api/runtime/file-explorer/events", (request, reply) =>
    sendSseEventStream(request, reply, fileEvents, {
      endpointId: getEndpointIdFromRequest(request),
    }),
  );

  app.get("/api/runtime/file-explorer/file", async (request, reply) => {
    const resolved = resolveFileEndpoint(request, reply, resolveEndpoint);
    if (!resolved) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const pathValue = queryString(request, "path");
    if (!pathValue) {
      return reply.status(400).send({ error: "Missing file path" });
    }

    try {
      const { backend, endpoint } = resolved;
      const content = await readTextFile(backend, pathValue);
      if (content.includes("\u0000")) {
        return reply
          .status(415)
          .send({ error: "Binary files cannot be edited in the browser." });
      }
      return reply.send({ endpointId: endpoint.id, path: pathValue, content });
    } catch (error) {
      return sendProxyError(reply, error);
    }
  });

  // A topology rendered like a deploy would render it, for the read-only template preview.
  app.get("/api/runtime/file-explorer/rendered", async (request, reply) => {
    const resolved = resolveFileEndpoint(request, reply, resolveEndpoint);
    if (!resolved) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const pathValue = queryString(request, "path");
    if (!pathValue) {
      return reply.status(400).send({ error: "Missing file path" });
    }
    const varsFile = queryString(request, "varsFile").trim();

    try {
      const { backend, endpoint } = resolved;
      // The lab host resolves flat workspace files by the lab name it lists them under.
      const listed = await backend.listTopologies().catch(() => []);
      const labName =
        listed.find((entry) => entry.yamlFileName === pathValue)?.labName ??
        topologyFileStem(pathValue);
      const rendered = await backend.renderTopology(
        { labName, path: pathValue },
        varsFile ? { varsFile } : {},
      );
      return reply.send({ endpointId: endpoint.id, path: pathValue, ...rendered });
    } catch (error) {
      return sendProxyError(reply, error);
    }
  });

  app.put("/api/runtime/file-explorer/file", async (request, reply) => {
    const resolved = resolveFileEndpoint(request, reply, resolveEndpoint);
    if (!resolved) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const pathValue =
      queryString(request, "path") || bodyString(request, "path");
    const content = bodyString(request, "content");
    if (!pathValue) {
      return reply.status(400).send({ error: "Missing file path" });
    }
    if (content.length > MAX_TEXT_FILE_BYTES) {
      return reply
        .status(413)
        .send({ error: "File is too large to edit in the browser." });
    }

    try {
      const { backend, endpoint } = resolved;
      const originalContent = bodyRecord(request).originalContent;
      const documentPath = pathValue.replace(/\.clab\.(ya?ml)\.annotations\.json$/, ".clab.$1");
      await runDocumentOperation(JSON.stringify([backend.scope, documentPath]), async () => {
        if (typeof originalContent === "string") {
          let currentContent: string;
          try {
            currentContent = await readTextFile(backend, pathValue);
          } catch (error) {
            if (errorStatus(error) !== 404) throw error;
            throw Object.assign(new Error("This file was deleted on the server. Your edits have been kept."), { status: 409 });
          }
          if (currentContent !== originalContent) {
            throw Object.assign(new Error("This file changed on the server. Your edits have been kept. Copy them before closing and reopening the file."), { status: 409 });
          }
        }
        await backend.fs.write(pathValue, content);
      });
      return reply.send({
        endpointId: endpoint.id,
        path: pathValue,
        success: true,
      });
    } catch (error) {
      return sendProxyError(reply, error);
    }
  });

  app.delete("/api/runtime/file-explorer/file", async (request, reply) => {
    const resolved = resolveFileEndpoint(request, reply, resolveEndpoint);
    if (!resolved) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const pathValue = queryString(request, "path");
    if (!pathValue) {
      return reply.status(400).send({ error: "Missing file path" });
    }

    try {
      const { backend, endpoint } = resolved;
      await backend.fs.delete(pathValue, {
        recursive: queryString(request, "recursive") === "true",
      });
      return reply.send({
        endpointId: endpoint.id,
        path: pathValue,
        success: true,
      });
    } catch (error) {
      return sendProxyError(reply, error);
    }
  });

  app.post("/api/runtime/file-explorer/file/rename", async (request, reply) => {
    const resolved = resolveFileEndpoint(request, reply, resolveEndpoint);
    if (!resolved) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const oldPath = bodyString(request, "oldPath");
    const newPath = bodyString(request, "newPath");
    if (!oldPath || !newPath) {
      return reply.status(400).send({ error: "Missing source or target path" });
    }

    try {
      const { backend, endpoint } = resolved;
      await backend.fs.rename(oldPath, newPath);
      return reply.send({
        endpointId: endpoint.id,
        oldPath,
        newPath,
        success: true,
      });
    } catch (error) {
      return sendProxyError(reply, error);
    }
  });

  app.post("/api/runtime/file-explorer/directory", async (request, reply) => {
    const resolved = resolveFileEndpoint(request, reply, resolveEndpoint);
    if (!resolved) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const pathValue = bodyString(request, "path");
    if (!pathValue) {
      return reply.status(400).send({ error: "Missing directory path" });
    }

    try {
      const { backend, endpoint } = resolved;
      await backend.fs.mkdir(pathValue);
      return reply.send({
        endpointId: endpoint.id,
        path: pathValue,
        success: true,
      });
    } catch (error) {
      return sendProxyError(reply, error);
    }
  });
}
