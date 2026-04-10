import Fastify from "fastify";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import path from "node:path";

import { registerAuthRoutes } from "./auth.js";
import type { EndpointEntry, EndpointSession } from "./endpointSessionStore.js";
import {
  DEFAULT_ENDPOINT_SESSION_DURATION,
  buildEndpointId,
  createEndpointSessionStore
} from "./endpointSessionStore.js";
import { registerEventsProxy } from "./eventsProxy.js";
import { registerFileProxy } from "./fileProxy.js";
import { registerLabProxy } from "./labProxy.js";
import {
  getEndpointIdFromRequest,
  getLegacySessionCookies,
  getSessionIdFromRequest,
  setSessionCookie
} from "./middleware.js";
import { registerCaptureVncStreamProxy } from "./captureVncStreamProxy.js";
import { registerRuntimeProxy } from "./runtimeProxy.js";
import { registerTerminalStreamProxy } from "./terminalStreamProxy.js";
import { registerTopologyEventsProxy } from "./topologyEventsProxy.js";
import { registerTopologyProxy } from "./topologyProxy.js";
import { createStandaloneTopologySessionManager } from "./topologySessionManager.js";
import { ClabApiClient } from "./clabApiClient.js";

interface ResolvedEndpoint {
  client: ClabApiClient;
  endpoint: EndpointEntry;
  session: EndpointSession;
}

interface StandaloneServerConfig {
  clientRoot: string;
  defaultClabApiUrl: string;
  host: string;
  isDev: boolean;
  logger: boolean;
  logStartup: boolean;
  port: number;
  viteDevUrl: string;
}

export interface StartStandaloneServerOptions {
  clientRoot?: string;
  defaultClabApiUrl?: string;
  host?: string;
  logger?: boolean;
  logStartup?: boolean;
  nodeEnv?: "development" | "production";
  port?: number;
  viteDevUrl?: string;
}

export interface StandaloneServerContext {
  app: FastifyInstance;
  config: StandaloneServerConfig;
}

export interface StandaloneServerHandle {
  app: FastifyInstance;
  close: () => Promise<void>;
  host: string;
  origin: string;
  port: number;
}

function parsePort(raw: number | string | undefined, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw);
  }
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return fallback;
}

function defaultEndpointLabel(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function resolveConfig(options: StartStandaloneServerOptions = {}): StandaloneServerConfig {
  const resolvedNodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const isDev = resolvedNodeEnv !== "production";

  return {
    host: options.host ?? process.env.HOST ?? "0.0.0.0",
    port: parsePort(options.port ?? process.env.PORT, 3000),
    defaultClabApiUrl: options.defaultClabApiUrl ?? process.env.CLAB_API_URL ?? "http://localhost:8080",
    viteDevUrl: options.viteDevUrl ?? process.env.VITE_DEV_URL ?? "http://localhost:5173",
    clientRoot: options.clientRoot ?? path.resolve(process.cwd(), "dist/client"),
    isDev,
    logger: options.logger ?? true,
    logStartup: options.logStartup ?? true
  };
}

function resolveListeningOrigin(host: string, port: number): string {
  if (host === "0.0.0.0" || host === "::") {
    return `http://127.0.0.1:${port}`;
  }
  return `http://${host}:${port}`;
}

export async function createStandaloneServer(
  options: StartStandaloneServerOptions = {}
): Promise<StandaloneServerContext> {
  const config = resolveConfig(options);
  const app = Fastify({ logger: config.logger });

  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: config.isDev ? true : false,
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
    const legacy = getLegacySessionCookies(request, config.defaultClabApiUrl);
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
    defaultApiUrl: config.defaultClabApiUrl,
    disposeEndpointSessions: topologySessions.disposeSessionsForEndpoint,
    ensureSession,
    endpointSessions,
    resolveSession
  });
  registerEventsProxy(app, resolveEndpoint);
  registerTopologyEventsProxy(app, resolveEndpoint, topologySessions);
  registerTopologyProxy(app, resolveEndpoint, topologySessions);
  registerFileProxy(app, resolveEndpoint);
  registerLabProxy(app, resolveEndpoint, topologySessions);
  registerRuntimeProxy(app, resolveEndpoint, listEndpoints, topologySessions);
  registerCaptureVncStreamProxy(app, resolveEndpoint);
  registerTerminalStreamProxy(app, resolveEndpoint);

  app.get("/api/config", async (request, reply) => {
    const endpoints = listEndpoints(request, reply).map((entry) => ({
      id: entry.id,
      url: entry.url,
      label: entry.label,
      username: entry.username,
      sessionDuration: entry.sessionDuration
    }));
    return reply.send({ endpoints, defaultClabApiUrl: config.defaultClabApiUrl });
  });

  if (config.isDev) {
    app.route({
      method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
      url: "/*",
      handler: async (request, reply) => {
        try {
          const url = `${config.viteDevUrl}${request.url}`;
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

    await app.register(fastifyStatic.default, {
      root: config.clientRoot,
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

  return { app, config };
}

export async function startStandaloneServer(
  options: StartStandaloneServerOptions = {}
): Promise<StandaloneServerHandle> {
  const { app, config } = await createStandaloneServer(options);

  await app.listen({ port: config.port, host: config.host });

  const address = app.server.address();
  const port =
    typeof address === "object" && address !== null ? address.port : config.port;
  const origin = resolveListeningOrigin(config.host, port);

  if (config.logStartup) {
    console.log(`Standalone app server running at ${origin}`);
    console.log(`default clab-api-server URL: ${config.defaultClabApiUrl}`);
    if (config.isDev) {
      console.log(`Proxying frontend to: ${config.viteDevUrl}`);
    }
  }

  return {
    app,
    host: config.host,
    port,
    origin,
    close: async () => {
      if (app.server.listening) {
        await app.close();
      }
    }
  };
}
