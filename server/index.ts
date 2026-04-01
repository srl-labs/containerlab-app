/**
 * Standalone web app backend server.
 *
 * Serves the React frontend and proxies API requests to clab-api-server.
 * In development mode, proxies unmatched requests to Vite dev server.
 */

import Fastify from "fastify";
import type { FastifyRequest } from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyWebsocket from "@fastify/websocket";
import { ClabApiClient } from "./clabApiClient.js";
import { getApiUrlFromRequest, getTokenFromRequest } from "./middleware.js";
import { registerAuthRoutes } from "./auth.js";
import { registerEventsProxy } from "./eventsProxy.js";
import { registerTopologyProxy } from "./topologyProxy.js";
import { registerFileProxy } from "./fileProxy.js";
import { registerLabProxy } from "./labProxy.js";
import { registerTopologyEventsProxy } from "./topologyEventsProxy.js";
import { createStandaloneTopologySessionManager } from "./topologySessionManager.js";
import { registerRuntimeProxy } from "./runtimeProxy.js";
import { registerTerminalStreamProxy } from "./terminalStreamProxy.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const DEFAULT_CLAB_API_URL = process.env.CLAB_API_URL ?? "http://localhost:8080";
const VITE_DEV_URL = process.env.VITE_DEV_URL ?? "http://localhost:5173";
const IS_DEV = process.env.NODE_ENV !== "production";

async function start(): Promise<void> {
  const app = Fastify({ logger: true });

  // Plugins
  await app.register(fastifyCookie);
  await app.register(fastifyCors, {
    origin: IS_DEV ? true : false,
    credentials: true
  });
  await app.register(fastifyWebsocket);

  const topologySessions = createStandaloneTopologySessionManager();

  const getClient = (request: FastifyRequest): ClabApiClient =>
    new ClabApiClient({
      baseUrl: getApiUrlFromRequest(request, DEFAULT_CLAB_API_URL)
    });

  // Register routes
  registerAuthRoutes(app, getClient, DEFAULT_CLAB_API_URL, (request) => {
    const token = getTokenFromRequest(request);
    if (!token) {
      return;
    }
    topologySessions.disposeSessionsForToken(
      token,
      getApiUrlFromRequest(request, DEFAULT_CLAB_API_URL)
    );
  });
  registerEventsProxy(app, getClient);
  registerTopologyEventsProxy(app, getClient, topologySessions);
  registerTopologyProxy(app, getClient, topologySessions);
  registerFileProxy(app, getClient);
  registerLabProxy(app, getClient, topologySessions);
  registerRuntimeProxy(app, getClient, topologySessions);
  registerTerminalStreamProxy(app, getClient);
  app.get("/api/config", async (request, reply) => {
    const clabApiUrl = getApiUrlFromRequest(request, DEFAULT_CLAB_API_URL);
    return reply.send({ clabApiUrl, defaultClabApiUrl: DEFAULT_CLAB_API_URL });
  });

  if (IS_DEV) {
    // In development, proxy unmatched requests to Vite dev server
    app.route({
      method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
      url: "/*",
      handler: async (request, reply) => {
        try {
          const url = `${VITE_DEV_URL}${request.url}`;
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(request.headers)) {
            if (typeof value === "string") {
              headers[key] = value;
            }
          }
          // Remove host header to avoid Vite rejecting it
          delete headers.host;

          const response = await fetch(url, {
            method: request.method,
            headers,
            body: request.method !== "GET" && request.method !== "HEAD"
              ? JSON.stringify(request.body)
              : undefined
          });

          reply.status(response.status);
          for (const [key, value] of response.headers.entries()) {
            // Skip transfer-encoding as Fastify handles it
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
    // In production, serve static files from dist/client
    const fastifyStatic = await import("@fastify/static");
    const path = await import("node:path");
    const clientRoot = path.resolve(process.cwd(), "dist/client");

    await app.register(fastifyStatic.default, {
      root: clientRoot,
      prefix: "/"
    });

    // SPA fallback
    app.setNotFoundHandler((_request, reply) => {
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => {
    topologySessions.disposeAll();
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
  console.log(`Standalone app server running at http://localhost:${PORT}`);
  console.log(`default clab-api-server URL: ${DEFAULT_CLAB_API_URL}`);
  if (IS_DEV) {
    console.log(`Proxying frontend to: ${VITE_DEV_URL}`);
  }
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
