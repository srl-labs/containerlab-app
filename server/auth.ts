/**
 * Auth routes - proxies login to clab-api-server and manages JWT cookies.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { ClabApiClient } from "./clabApiClient.js";
import {
  clearTokenCookie,
  getApiUrlFromRequest,
  getTokenFromRequest,
  normalizeApiUrl,
  setApiUrlCookie,
  setTokenCookie
} from "./middleware.js";

type ClientResolver = (request: FastifyRequest) => ClabApiClient;

export function registerAuthRoutes(
  app: FastifyInstance,
  getClient: ClientResolver,
  defaultApiUrl: string,
  onLogout?: (request: FastifyRequest) => void
): void {
  app.post<{
    Body: { username: string; password: string; apiUrl?: string };
  }>("/auth/login", async (request, reply) => {
    const { username, password, apiUrl } = request.body;

    if (!username || !password) {
      return reply.status(400).send({ error: "Username and password are required" });
    }

    let selectedApiUrl = getApiUrlFromRequest(request, defaultApiUrl);
    if (typeof apiUrl === "string" && apiUrl.trim().length > 0) {
      const normalized = normalizeApiUrl(apiUrl);
      if (!normalized) {
        return reply.status(400).send({ error: "Invalid API endpoint URL" });
      }
      selectedApiUrl = normalized;
    }

    try {
      const client = new ClabApiClient({ baseUrl: selectedApiUrl });
      const result = await client.login(username, password);
      setTokenCookie(reply, result.token);
      setApiUrlCookie(reply, selectedApiUrl);
      return reply.send({ success: true, username, clabApiUrl: selectedApiUrl });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      return reply.status(401).send({ error: message });
    }
  });

  app.post("/auth/logout", async (request, reply) => {
    onLogout?.(request);
    clearTokenCookie(reply);
    return reply.send({ success: true });
  });

  app.get("/auth/me", async (request, reply) => {
    const token = getTokenFromRequest(request);
    if (!token) {
      return reply.send({ authenticated: false });
    }

    // Validate token by making a lightweight API call
    try {
      const client = getClient(request);
      await client.listTopologies(token);
      return reply.send({ authenticated: true });
    } catch {
      clearTokenCookie(reply);
      return reply.send({ authenticated: false });
    }
  });
}
