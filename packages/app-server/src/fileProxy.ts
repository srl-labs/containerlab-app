/**
 * File listing proxy - returns topology files in the format the Explorer expects.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  getHttpErrorStatus,
  type ClabApiClient,
  type WorkspaceFileEntry,
} from "./clabApiClient.ts";
import type { EndpointEntry } from "./endpointSessionStore.ts";
import { getEndpointIdFromRequest } from "./middleware.ts";
import {
  disableStreamTimeouts,
  startSseHeartbeat,
  streamResponseHeaders,
} from "./streamResponseHeaders.ts";
import { buildStandaloneTopologyRef } from "./topologyIdentity.ts";

type EndpointResolver = (
  request: FastifyRequest,
  reply: FastifyReply,
  endpointId?: string,
) => { client: ClabApiClient; endpoint: EndpointEntry } | null;

interface WorkspaceFileExplorerEntry extends WorkspaceFileEntry {
  endpointId: string;
  topologyRef?: ReturnType<typeof buildStandaloneTopologyRef>;
  labName?: string;
  deploymentState?: string;
}

const MAX_TEXT_FILE_BYTES = 1024 * 1024;

class ResponseBodyTooLargeError extends Error {
  readonly status = 413;

  constructor() {
    super("File is too large to edit in the browser.");
  }
}

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

async function readTextResponseWithLimit(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new ResponseBodyTooLargeError();
  }

  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new ResponseBodyTooLargeError();
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw new ResponseBodyTooLargeError();
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  const content = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(content);
}

function resolveFileEndpoint(
  request: FastifyRequest,
  reply: FastifyReply,
  resolveEndpoint: EndpointResolver,
): { client: ClabApiClient; endpoint: EndpointEntry } | null {
  return resolveEndpoint(request, reply, getEndpointIdFromRequest(request));
}

async function forwardNdjsonAsSse(
  body: ReadableStream<Uint8Array>,
  reply: FastifyReply,
  isAborted: () => boolean,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventId = 0;

  try {
    while (!isAborted()) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (isAborted()) {
          break;
        }
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        eventId += 1;
        reply.raw.write(`id: ${eventId}\ndata: ${trimmed}\n\n`);
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
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
      const { client, endpoint } = resolved;
      const topologies = await client.listTopologies(endpoint.token);
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
      const { client, endpoint } = resolved;
      const entries = await client.listWorkspaceTree(
        endpoint.token,
        queryString(request, "path"),
      );
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

  app.get("/api/runtime/file-explorer/events", async (request, reply) => {
    const resolved = resolveFileEndpoint(request, reply, resolveEndpoint);
    if (!resolved) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const { client, endpoint } = resolved;
    disableStreamTimeouts(request, reply);

    reply.raw.writeHead(
      200,
      streamResponseHeaders(request, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      }),
    );
    reply.raw.write(":ok\n\n");
    const stopHeartbeat = startSseHeartbeat(reply);

    let aborted = false;
    const abortController = new AbortController();
    const abort = (): void => {
      aborted = true;
      abortController.abort();
    };
    reply.raw.on("close", abort);

    try {
      const response = await client.openWorkspaceEventStream(endpoint.token, {
        signal: abortController.signal,
      });
      if (!response.body) {
        reply.raw.write(
          "event: error\ndata: No workspace event stream body\n\n",
        );
        reply.raw.end();
        return;
      }

      await forwardNdjsonAsSse(response.body, reply, () => aborted);
    } catch (error) {
      if (!aborted) {
        const message =
          error instanceof Error
            ? error.message
            : "Workspace event stream error";
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`,
        );
      }
    } finally {
      stopHeartbeat();
      reply.raw.off("close", abort);
      if (!aborted && !reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  });

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
      const { client, endpoint } = resolved;
      const response = await client.openWorkspaceFile(endpoint.token, pathValue);
      const content = await readTextResponseWithLimit(
        response,
        MAX_TEXT_FILE_BYTES,
      );
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
      const { client, endpoint } = resolved;
      await client.putWorkspaceFile(endpoint.token, pathValue, content);
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
      const { client, endpoint } = resolved;
      await client.deleteWorkspaceFile(endpoint.token, pathValue, {
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
      const { client, endpoint } = resolved;
      await client.renameWorkspaceFile(endpoint.token, oldPath, newPath);
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
      const { client, endpoint } = resolved;
      await client.createWorkspaceDirectory(endpoint.token, pathValue);
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
