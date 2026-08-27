import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import WebSocket, { type RawData } from "ws";
import type { ServerOptions as HttpsServerOptions } from "node:https";
import type { AppConfigResponse } from "@srl-labs/containerlab-app-contract";

import { registerAuthRoutes } from "./auth.ts";
import type { EndpointEntry, EndpointSession } from "./endpointSessionStore.ts";
import {
  DEFAULT_ENDPOINT_SESSION_DURATION,
  buildEndpointId,
  createEndpointSessionStore,
} from "./endpointSessionStore.ts";
import {
  getEndpointIdFromRequest,
  getLegacySessionCookies,
  getSessionIdFromRequest,
  setSessionCookie,
} from "./middleware.ts";
import { registerStandaloneProxies } from "./registerProxies.ts";
import { createStandaloneTopologySessionManager } from "./topologySessionManager.ts";
import { ClabApiClient } from "./clabApiClient.ts";

interface ResolvedEndpoint {
  client: ClabApiClient;
  endpoint: EndpointEntry;
  session: EndpointSession;
}

export interface CreateStandaloneAppOptions {
  basePath?: string;
  defaultClabApiUrl?: string;
  https?: HttpsServerOptions;
  isDev?: boolean;
  logger?: boolean;
  sessionPersistenceFile?: string;
  staticClientRoot?: string;
  viteDevUrl?: string;
}

export function normalizeBasePath(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0 || trimmed === "/") {
    return "";
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

function defaultEndpointLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function isSecureRequest(request: FastifyRequest): boolean {
  if (request.protocol === "https") {
    return true;
  }
  const forwardedProto = request.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string") {
    return forwardedProto
      .split(",")
      .some((value) => value.trim().toLowerCase() === "https");
  }
  return false;
}

function isValidCloseCode(code: number): boolean {
  return (
    Number.isInteger(code) &&
    ((code >= 1000 &&
      code <= 1014 &&
      code !== 1004 &&
      code !== 1005 &&
      code !== 1006) ||
      (code >= 3000 && code <= 4999))
  );
}

function closeSocket(
  socket: WebSocket,
  code: number | undefined,
  reason: string,
): void {
  if (
    socket.readyState === WebSocket.CLOSING ||
    socket.readyState === WebSocket.CLOSED
  ) {
    return;
  }
  if (code !== undefined && isValidCloseCode(code)) {
    socket.close(code, reason);
    return;
  }
  socket.close();
}

function requestWebSocketProtocols(request: FastifyRequest): string[] {
  const requestedProtocolHeader = request.headers["sec-websocket-protocol"];
  if (typeof requestedProtocolHeader !== "string") {
    return [];
  }
  return requestedProtocolHeader
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function buildViteDevWebSocketUrl(
  viteDevUrl: string,
  request: FastifyRequest,
): string {
  const upstreamUrl = new URL(request.raw.url ?? "/", viteDevUrl);
  upstreamUrl.protocol = upstreamUrl.protocol === "https:" ? "wss:" : "ws:";
  return upstreamUrl.toString();
}

function proxyViteDevWebSocket(
  app: FastifyInstance,
  viteDevUrl: string,
  socket: WebSocket,
  request: FastifyRequest,
): void {
  const protocols = requestWebSocketProtocols(request);
  const origin =
    typeof request.headers.origin === "string"
      ? request.headers.origin
      : undefined;
  const upstreamOptions = origin
    ? { headers: { Origin: origin }, rejectUnauthorized: false }
    : { rejectUnauthorized: false };
  const upstreamUrl = buildViteDevWebSocketUrl(viteDevUrl, request);
  const upstream =
    protocols.length > 0
      ? new WebSocket(upstreamUrl, protocols, upstreamOptions)
      : new WebSocket(upstreamUrl, upstreamOptions);

  upstream.on("open", () => {
    socket.on("message", (data: RawData, isBinary: boolean) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      }
    });
  });

  upstream.on("message", (data: RawData, isBinary: boolean) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data, { binary: isBinary });
    }
  });

  upstream.on("close", (code: number, reason: Buffer) => {
    closeSocket(socket, code, reason.toString() || "Vite dev websocket closed");
  });

  upstream.on("error", (error: Error) => {
    app.log.warn(
      { err: error, url: upstreamUrl },
      "vite dev websocket proxy error",
    );
    closeSocket(socket, 1011, "Vite dev websocket proxy failed");
  });

  socket.on("close", () => {
    closeSocket(upstream, 1000, "Browser closed");
  });

  socket.on("error", (error: Error) => {
    app.log.warn({ err: error }, "vite dev websocket client error");
    closeSocket(upstream, 1011, "Vite dev websocket client failed");
  });
}

export async function createStandaloneApp(
  options: CreateStandaloneAppOptions = {},
): Promise<FastifyInstance> {
  const defaultClabApiUrl =
    options.defaultClabApiUrl ?? "https://localhost:8090";
  const isDev = options.isDev ?? process.env.NODE_ENV !== "production";
  const viteDevUrl = options.viteDevUrl ?? "https://localhost:5173";
  const basePath = normalizeBasePath(options.basePath);
  const fastifyOptions = {
    logger: options.logger ?? true,
    requestTimeout: 0,
  };
  const app: FastifyInstance = options.https
    ? (Fastify({ ...fastifyOptions, https: options.https }) as FastifyInstance)
    : (Fastify(fastifyOptions) as FastifyInstance);

  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: isDev ? true : false,
    credentials: true,
  });
  await app.register(fastifyWebsocket);

  const endpointSessions = createEndpointSessionStore({
    persistenceFile: options.sessionPersistenceFile,
  });
  const topologySessions = createStandaloneTopologySessionManager();

  const maybeSetSessionCookie = (
    request: FastifyRequest,
    reply: FastifyReply,
    sessionId: string,
  ): void => {
    if (typeof (reply as Partial<FastifyReply>).setCookie === "function") {
      setSessionCookie(reply, sessionId, isSecureRequest(request));
    }
  };

  const migrateLegacySession = (
    request: FastifyRequest,
    reply: FastifyReply,
  ): EndpointSession | null => {
    const legacy = getLegacySessionCookies(request, defaultClabApiUrl);
    if (!legacy) {
      return null;
    }

    const existingSessionId = getSessionIdFromRequest(request);
    if (existingSessionId) {
      const existing = endpointSessions.getSession(existingSessionId);
      if (existing) {
        return existing;
      }
    }

    const sessionId = existingSessionId ?? globalThis.crypto.randomUUID();
    if (!existingSessionId) {
      maybeSetSessionCookie(request, reply, sessionId);
    }

    const migratedEntry: EndpointEntry = {
      id: buildEndpointId(),
      url: legacy.url,
      label: defaultEndpointLabel(legacy.url),
      token: legacy.token,
      username: "user",
      sessionDuration: DEFAULT_ENDPOINT_SESSION_DURATION,
    };

    return endpointSessions.replaceSession(sessionId, [migratedEntry]);
  };

  const resolveSession = (
    request: FastifyRequest,
    reply: FastifyReply,
  ): EndpointSession | null => {
    const sessionId = getSessionIdFromRequest(request);
    if (sessionId) {
      const session = endpointSessions.getSession(sessionId);
      if (session) {
        return session;
      }
    }
    return migrateLegacySession(request, reply);
  };

  const ensureSession = (
    request: FastifyRequest,
    reply: FastifyReply,
  ): EndpointSession => {
    const resolved = resolveSession(request, reply);
    if (resolved) {
      return resolved;
    }

    const sessionId =
      getSessionIdFromRequest(request) ?? globalThis.crypto.randomUUID();
    if (!getSessionIdFromRequest(request)) {
      maybeSetSessionCookie(request, reply, sessionId);
    }
    return endpointSessions.replaceSession(sessionId, []);
  };

  const resolveEndpoint = (
    request: FastifyRequest,
    reply: FastifyReply,
    preferredEndpointId?: string,
  ): ResolvedEndpoint | null => {
    const session = resolveSession(request, reply);
    if (!session || session.endpoints.size === 0) {
      return null;
    }

    const endpointId = preferredEndpointId ?? getEndpointIdFromRequest(request);
    const endpoint = endpointId
      ? (session.endpoints.get(endpointId) ?? null)
      : (Array.from(session.endpoints.values())[0] ?? null);
    if (!endpoint) {
      return null;
    }

    return {
      session,
      endpoint,
      client: new ClabApiClient({ baseUrl: endpoint.url }),
    };
  };

  const listEndpoints = (
    request: FastifyRequest,
    reply: FastifyReply,
  ): EndpointEntry[] => {
    const session = resolveSession(request, reply);
    return session ? Array.from(session.endpoints.values()) : [];
  };

  await app.register(
    async (scoped: FastifyInstance) => {
      registerAuthRoutes(scoped, {
        defaultApiUrl: defaultClabApiUrl,
        disposeEndpointSessions: topologySessions.disposeSessionsForEndpoint,
        ensureSession,
        endpointSessions,
        resolveSession,
      });
      registerStandaloneProxies(
        scoped,
        resolveEndpoint,
        listEndpoints,
        topologySessions,
      );

      scoped.get("/api/config", async (request, reply) => {
        const endpoints = listEndpoints(request, reply).map((entry) => ({
          id: entry.id,
          url: entry.url,
          label: entry.label,
          username: entry.username,
          sessionDuration: entry.sessionDuration,
        }));
        const payload: AppConfigResponse = { endpoints, defaultClabApiUrl };
        return reply.send(payload);
      });
    },
    { prefix: basePath },
  );

  if (isDev) {
    const proxyViteDevHttp = async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      try {
        const url = `${viteDevUrl}${request.url}`;
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(request.headers)) {
          if (typeof value === "string") {
            headers[key] = value;
          }
        }
        delete headers.host;

        const response = await fetch(url, {
          method: request.method,
          headers,
          body:
            request.method !== "GET" && request.method !== "HEAD"
              ? JSON.stringify(request.body)
              : undefined,
        });

        reply.status(response.status);
        for (const [key, value] of response.headers.entries()) {
          if (key.toLowerCase() === "transfer-encoding") continue;
          reply.header(key, value);
        }

        const body = await response.arrayBuffer();
        return reply.send(Buffer.from(body));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Proxy error";
        return reply.status(502).send({ error: message });
      }
    };

    app.route({
      method: "GET",
      url: "/*",
      wsHandler: (socket, request) => {
        proxyViteDevWebSocket(app, viteDevUrl, socket, request);
      },
      handler: proxyViteDevHttp,
    });

    app.route({
      method: ["POST", "PUT", "PATCH", "DELETE"],
      url: "/*",
      handler: proxyViteDevHttp,
    });
  } else {
    const fastifyStatic = await import("@fastify/static");
    const path = await import("node:path");
    const clientRoot =
      options.staticClientRoot ?? path.resolve(process.cwd(), "dist/client");

    const { readFile } = await import("node:fs/promises");
    const documents = new Map<string, string>();

    const readDocument = async (name: string): Promise<string> => {
      const cached = documents.get(name);
      if (cached !== undefined) {
        return cached;
      }
      const html = await readFile(path.join(clientRoot, name), "utf8");
      const baseTag = `<base href="${basePath}/">`;
      const headMatch = /<head(\s[^>]*)?>/i.exec(html);
      const doctypeMatch = /<!doctype[^>]*>/i.exec(html);
      const anchor = headMatch ?? doctypeMatch;
      const withBase = anchor
        ? `${html.slice(0, anchor.index + anchor[0].length)}${baseTag}${html.slice(
            anchor.index + anchor[0].length,
          )}`
        : `${baseTag}${html}`;
      documents.set(name, withBase);
      return withBase;
    };

    const sendDocument = async (name: string, reply: FastifyReply) => {
      return reply.type("text/html; charset=utf-8").send(await readDocument(name));
    };

    await app.register(fastifyStatic.default, {
      root: clientRoot,
      prefix: `${basePath}/`,
      index: false,
    });

    if (basePath) {
      app.get(basePath, (_request, reply) => {
        return reply.redirect(`${basePath}/`, 308);
      });
    }

    for (const name of ["index.html", "terminal.html", "wireshark.html"]) {
      app.get(`${basePath}/${name}`, async (_request, reply) => {
        return sendDocument(name, reply);
      });
    }

    app.get(`${basePath}/`, async (_request, reply) => {
      return sendDocument("index.html", reply);
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (basePath && !request.url.startsWith(`${basePath}/`)) {
        return reply.code(404).send({ error: "Not Found" });
      }
      return sendDocument("index.html", reply);
    });
  }

  app.addHook("onClose", async () => {
    endpointSessions.dispose();
    topologySessions.disposeAll();
  });

  return app;
}
