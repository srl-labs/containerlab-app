import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";

import { registerAuthRoutes } from "./auth.js";
import type { EndpointEntry, EndpointSession } from "./endpointSessionStore.js";
import {
  DEFAULT_ENDPOINT_SESSION_DURATION,
  buildEndpointId,
  createEndpointSessionStore
} from "./endpointSessionStore.js";
import {
  getEndpointIdFromRequest,
  getLegacySessionCookies,
  getSessionIdFromRequest,
  setSessionCookie
} from "./middleware.js";
import { registerStandaloneProxies } from "./registerProxies.js";
import { createStandaloneTopologySessionManager } from "./topologySessionManager.js";
import { ClabApiClient } from "./clabApiClient.js";

interface ResolvedEndpoint {
  client: ClabApiClient;
  endpoint: EndpointEntry;
  session: EndpointSession;
}

export interface CreateStandaloneAppOptions {
  defaultClabApiUrl?: string;
  isDev?: boolean;
  logger?: boolean;
  viteDevUrl?: string;
}

function defaultEndpointLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

export async function createStandaloneApp(
  options: CreateStandaloneAppOptions = {}
): Promise<FastifyInstance> {
  const defaultClabApiUrl = options.defaultClabApiUrl ?? "http://localhost:8080";
  const isDev = options.isDev ?? process.env.NODE_ENV !== "production";
  const viteDevUrl = options.viteDevUrl ?? "http://localhost:5173";
  const app = Fastify({ logger: options.logger ?? true });

  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: isDev ? true : false,
    credentials: true
  });
  await app.register(fastifyWebsocket);

  const endpointSessions = createEndpointSessionStore();
  const topologySessions = createStandaloneTopologySessionManager();

  const maybeSetSessionCookie = (reply: FastifyReply, sessionId: string): void => {
    if (typeof (reply as Partial<FastifyReply>).setCookie === "function") {
      setSessionCookie(reply, sessionId);
    }
  };

  const migrateLegacySession = (
    request: FastifyRequest,
    reply: FastifyReply
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
      maybeSetSessionCookie(reply, sessionId);
    }

    const migratedEntry: EndpointEntry = {
      id: buildEndpointId(),
      url: legacy.url,
      label: defaultEndpointLabel(legacy.url),
      token: legacy.token,
      username: "user",
      sessionDuration: DEFAULT_ENDPOINT_SESSION_DURATION
    };

    return endpointSessions.replaceSession(sessionId, [migratedEntry]);
  };

  const resolveSession = (
    request: FastifyRequest,
    reply: FastifyReply
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
    reply: FastifyReply
  ): EndpointSession => {
    const resolved = resolveSession(request, reply);
    if (resolved) {
      return resolved;
    }

    const sessionId = getSessionIdFromRequest(request) ?? globalThis.crypto.randomUUID();
    if (!getSessionIdFromRequest(request)) {
      maybeSetSessionCookie(reply, sessionId);
    }
    return endpointSessions.replaceSession(sessionId, []);
  };

  const resolveEndpoint = (
    request: FastifyRequest,
    reply: FastifyReply,
    preferredEndpointId?: string
  ): ResolvedEndpoint | null => {
    const session = resolveSession(request, reply);
    if (!session || session.endpoints.size === 0) {
      return null;
    }

    const endpointId = preferredEndpointId ?? getEndpointIdFromRequest(request);
    const endpoint = endpointId
      ? session.endpoints.get(endpointId) ?? null
      : Array.from(session.endpoints.values())[0] ?? null;
    if (!endpoint) {
      return null;
    }

    return {
      session,
      endpoint,
      client: new ClabApiClient({ baseUrl: endpoint.url })
    };
  };

  const listEndpoints = (request: FastifyRequest, reply: FastifyReply): EndpointEntry[] => {
    const session = resolveSession(request, reply);
    return session ? Array.from(session.endpoints.values()) : [];
  };

  registerAuthRoutes(app, {
    defaultApiUrl: defaultClabApiUrl,
    disposeEndpointSessions: topologySessions.disposeSessionsForEndpoint,
    ensureSession,
    endpointSessions,
    resolveSession
  });
  registerStandaloneProxies(app, resolveEndpoint, listEndpoints, topologySessions);

  app.get("/api/config", async (request, reply) => {
    const endpoints = listEndpoints(request, reply).map((entry) => ({
      id: entry.id,
      url: entry.url,
      label: entry.label,
      username: entry.username,
      sessionDuration: entry.sessionDuration
    }));
    return reply.send({ endpoints, defaultClabApiUrl });
  });

  if (isDev) {
    app.route({
      method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
      url: "/*",
      handler: async (request, reply) => {
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
                : undefined
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
      }
    });
  } else {
    const fastifyStatic = await import("@fastify/static");
    const path = await import("node:path");
    const clientRoot = path.resolve(process.cwd(), "dist/client");

    await app.register(fastifyStatic.default, {
      root: clientRoot,
      prefix: "/"
    });

    app.setNotFoundHandler((_request, reply) => {
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => {
    endpointSessions.dispose();
    topologySessions.disposeAll();
  });

  return app;
}
