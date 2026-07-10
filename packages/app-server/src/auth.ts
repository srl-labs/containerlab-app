import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ClabApiClientFactory } from "./clabApiClient.ts";
import type {
  EndpointEntry,
  EndpointSession,
  EndpointSessionDuration,
  EndpointSessionStore
} from "./endpointSessionStore.ts";
import {
  buildEndpointId,
  isValidEndpointSessionDuration,
  normalizeEndpointSessionDuration
} from "./endpointSessionStore.ts";
import {
  clearLegacySessionCookies,
  clearSessionCookie,
  normalizeApiUrl
} from "./middleware.ts";
import {
  EndpointPolicyError,
  type EndpointAccessPolicy,
} from "./endpointPolicy.ts";

export interface EndpointPublicInfo {
  id: string;
  url: string;
  label: string;
  username: string;
  sessionDuration: EndpointSessionDuration;
  status: "connected" | "session_expired" | "offline";
  connected: boolean;
}

interface AddEndpointBody {
  label?: string;
  password: string;
  sessionDuration?: EndpointSessionDuration;
  url?: string;
  username: string;
  apiUrl?: string;
}

interface ReconnectEndpointBody {
  label?: string;
  password: string;
  sessionDuration?: EndpointSessionDuration;
  url?: string;
  username: string;
}

interface UpdateEndpointPreferencesBody {
  sessionDuration?: EndpointSessionDuration;
}

interface UpdateEndpointBody {
  label?: string;
  sessionDuration?: EndpointSessionDuration;
  url?: string;
  username?: string;
}

interface AuthRouteOptions {
  createClient: ClabApiClientFactory;
  defaultApiUrl: string;
  disposeEndpointSessions: (endpointId: string) => void;
  endpointSessions: EndpointSessionStore;
  endpointPolicy: EndpointAccessPolicy;
  resolveSession: (request: FastifyRequest, reply: FastifyReply) => EndpointSession | null;
  rotateSession: (request: FastifyRequest, reply: FastifyReply) => EndpointSession;
}

function defaultEndpointLabel(url: string, requestedLabel: string | undefined): string {
  const label = requestedLabel?.trim();
  if (label) {
    return label;
  }
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function toPublicInfo(
  entry: EndpointEntry,
  status: EndpointPublicInfo["status"]
): EndpointPublicInfo {
  return {
    id: entry.id,
    url: entry.url,
    label: entry.label,
    username: entry.username,
    sessionDuration: entry.sessionDuration,
    status,
    connected: status === "connected"
  };
}

async function validateEndpoint(
  entry: EndpointEntry,
  createClient: ClabApiClientFactory,
): Promise<EndpointPublicInfo> {
  const client = createClient(entry.url);
  try {
    await client.getVersion(entry.token);
    return toPublicInfo(entry, "connected");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (((error as { status?: unknown }).status === 401) ||
        ((error as { status?: unknown }).status === 403))
    ) {
      return toPublicInfo(entry, "session_expired");
    }
    return toPublicInfo(entry, "offline");
  }
}

async function listEndpointInfos(
  session: EndpointSession,
  createClient: ClabApiClientFactory,
  endpointPolicy: EndpointAccessPolicy,
): Promise<EndpointPublicInfo[]> {
  return await Promise.all(
    Array.from(session.endpoints.values())
      .filter((entry) => endpointPolicy.isAllowed(entry.url))
      .map((entry) => validateEndpoint(entry, createClient)),
  );
}

function requireCredentials(username: string | undefined, password: string | undefined): string | null {
  if (!username?.trim() || !password?.trim()) {
    return "Username and password are required";
  }
  return null;
}

function authErrorStatusCode(error: unknown): number {
  if (error instanceof EndpointPolicyError) {
    return error.statusCode;
  }
  if (
    error instanceof Error &&
    (error.message === "Invalid API endpoint URL" ||
      error.message === "Endpoint URL is required to reconnect" ||
      error.message === "Invalid session duration. Use values like 12h, 36h, 7d, or 1h30m")
  ) {
    return 400;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    ((((error as { status?: unknown }).status === 400) ||
      ((error as { status?: unknown }).status === 401) ||
      ((error as { status?: unknown }).status === 403)))
  ) {
    return Number((error as { status?: unknown }).status);
  }
  return 502;
}

function resolveEndpointSessionDuration(
  sessionDuration: EndpointSessionDuration | undefined
): EndpointSessionDuration {
  const normalized = normalizeEndpointSessionDuration(sessionDuration);
  if (!isValidEndpointSessionDuration(normalized)) {
    throw new Error("Invalid session duration. Use values like 12h, 36h, 7d, or 1h30m");
  }
  return normalized;
}

async function authenticateEndpoint(
  body: AddEndpointBody,
  options: Pick<AuthRouteOptions, "createClient" | "defaultApiUrl" | "endpointPolicy">,
): Promise<EndpointEntry> {
  const username = body.username?.trim() ?? "";
  const password = body.password;
  const sessionDuration = resolveEndpointSessionDuration(body.sessionDuration);
  const credentialError = requireCredentials(username, password);
  if (credentialError) {
    throw new Error(credentialError);
  }

  const rawUrl = body.url ?? body.apiUrl ?? options.defaultApiUrl;
  const normalizedUrl = normalizeApiUrl(rawUrl);
  if (!normalizedUrl) {
    throw new Error("Invalid API endpoint URL");
  }

  options.endpointPolicy.assertAllowed(normalizedUrl);
  const client = options.createClient(normalizedUrl);
  const result = await client.login(username, password, sessionDuration);

  return {
    id: buildEndpointId(),
    url: normalizedUrl,
    label: defaultEndpointLabel(normalizedUrl, body.label),
    token: result.token,
    username,
    sessionDuration
  };
}

async function reconnectEndpoint(
  endpointId: string,
  body: ReconnectEndpointBody,
  session: EndpointSession | null,
  options: AuthRouteOptions
): Promise<EndpointEntry> {
  const existing = session?.endpoints.get(endpointId) ?? null;
  const rawUrl = body.url ?? existing?.url;
  const normalizedUrl = rawUrl ? normalizeApiUrl(rawUrl) : null;
  if (!normalizedUrl) {
    throw new Error("Endpoint URL is required to reconnect");
  }
  options.endpointPolicy.assertAllowed(normalizedUrl);

  const sessionDuration = resolveEndpointSessionDuration(body.sessionDuration ?? existing?.sessionDuration);
  const result = await options.createClient(normalizedUrl).login(
    body.username.trim(),
    body.password,
    sessionDuration
  );
  const updated: EndpointEntry = {
    id: endpointId || existing?.id || buildEndpointId(),
    url: normalizedUrl,
    label: defaultEndpointLabel(normalizedUrl, body.label ?? existing?.label),
    token: result.token,
    username: body.username.trim(),
    sessionDuration
  };
  return updated;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  app.post<{ Body: AddEndpointBody }>("/auth/endpoints/add", async (request, reply) => {
    try {
      const entry = await authenticateEndpoint(request.body, options);
      const session = options.rotateSession(request, reply);
      options.disposeEndpointSessions(entry.id);
      options.endpointSessions.upsertEndpoint(session.sessionId, entry);
      clearLegacySessionCookies(reply);
      return reply.send(toPublicInfo(entry, "connected"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      return reply.status(authErrorStatusCode(error)).send({ error: message });
    }
  });

  app.post<{ Body: AddEndpointBody }>("/auth/login", async (request, reply) => {
    try {
      const entry = await authenticateEndpoint(request.body, options);
      const session = options.rotateSession(request, reply);
      options.disposeEndpointSessions(entry.id);
      options.endpointSessions.upsertEndpoint(session.sessionId, entry);
      clearLegacySessionCookies(reply);
      return reply.send({
        success: true,
        username: entry.username,
        clabApiUrl: entry.url,
        endpoint: toPublicInfo(entry, "connected")
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Login failed";
      return reply.status(authErrorStatusCode(error)).send({ error: message });
    }
  });

  app.get("/auth/endpoints", async (request, reply) => {
    const session = options.resolveSession(request, reply);
    if (!session) {
      return reply.send({ endpoints: [] });
    }

    return reply.send({
      endpoints: await listEndpointInfos(
        session,
        options.createClient,
        options.endpointPolicy,
      ),
    });
  });

  app.get<{ Params: { id: string } }>("/auth/endpoints/:id/metrics", async (request, reply) => {
    const session = options.resolveSession(request, reply);
    if (!session) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const endpointId = request.params.id.trim();
    const endpoint = session.endpoints.get(endpointId) ?? null;
    if (!endpoint) {
      return reply.status(404).send({ error: "Endpoint not found" });
    }

    try {
      const client = options.createClient(endpoint.url);
      return reply.send(await client.getHealthMetrics(endpoint.token));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load endpoint metrics";
      return reply.status(authErrorStatusCode(error)).send({ error: message });
    }
  });

  app.delete<{ Params: { id: string } }>("/auth/endpoints/:id", async (request, reply) => {
    const session = options.resolveSession(request, reply);
    if (!session) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const endpointId = request.params.id.trim();
    const result = options.endpointSessions.removeEndpoint(session.sessionId, endpointId);
    if (!result.removed) {
      return reply.status(404).send({ error: "Endpoint not found" });
    }

    options.disposeEndpointSessions(endpointId);
    clearLegacySessionCookies(reply);
    if (result.sessionEmpty) {
      clearSessionCookie(reply);
    }

    return reply.send({ success: true });
  });

  app.post<{ Body: ReconnectEndpointBody; Params: { id: string } }>(
    "/auth/endpoints/:id/reconnect",
    async (request, reply) => {
      const endpointId = request.params.id.trim();
      const credentialError = requireCredentials(request.body.username, request.body.password);
      if (credentialError) {
        return reply.status(400).send({ error: credentialError });
      }

      try {
        const session = options.resolveSession(request, reply);
        const updated = await reconnectEndpoint(endpointId, request.body, session, options);
        const rotatedSession = options.rotateSession(request, reply);
        options.disposeEndpointSessions(endpointId);
        options.endpointSessions.upsertEndpoint(rotatedSession.sessionId, updated);
        clearLegacySessionCookies(reply);
        return reply.send(toPublicInfo(updated, "connected"));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Reconnect failed";
        return reply.status(authErrorStatusCode(error)).send({ error: message });
      }
    }
  );

  app.patch<{ Body: UpdateEndpointPreferencesBody; Params: { id: string } }>(
    "/auth/endpoints/:id/preferences",
    async (request, reply) => {
      try {
        const session = options.resolveSession(request, reply);
        if (!session) {
          return reply.status(401).send({ error: "Not authenticated" });
        }

        const endpointId = request.params.id.trim();
        const existing = session.endpoints.get(endpointId) ?? null;
        if (!existing) {
          return reply.status(404).send({ error: "Endpoint not found" });
        }

        const updated: EndpointEntry = {
          ...existing,
          sessionDuration: resolveEndpointSessionDuration(request.body.sessionDuration)
        };
        options.endpointSessions.upsertEndpoint(session.sessionId, updated);
        return reply.send(toPublicInfo(updated, "connected"));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to update endpoint preferences";
        return reply.status(authErrorStatusCode(error)).send({ error: message });
      }
    }
  );

  app.patch<{ Body: UpdateEndpointBody; Params: { id: string } }>(
    "/auth/endpoints/:id",
    async (request, reply) => {
      const session = options.resolveSession(request, reply);
      if (!session) {
        return reply.status(401).send({ error: "Not authenticated" });
      }

      const endpointId = request.params.id.trim();
      const existing = session.endpoints.get(endpointId) ?? null;
      if (!existing) {
        return reply.status(404).send({ error: "Endpoint not found" });
      }

      const nextUrl =
        request.body.url !== undefined
          ? normalizeApiUrl(request.body.url)
          : existing.url;
      if (!nextUrl) {
        return reply.status(400).send({ error: "Invalid API endpoint URL" });
      }
      if (nextUrl !== existing.url) {
        return reply.status(400).send({
          error: "Changing an endpoint URL requires reconnecting with credentials",
        });
      }
      try {
        options.endpointPolicy.assertAllowed(nextUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Endpoint is not allowed";
        return reply.status(authErrorStatusCode(error)).send({ error: message });
      }

      const nextUsername =
        request.body.username !== undefined ? request.body.username.trim() : existing.username;
      if (!nextUsername) {
        return reply.status(400).send({ error: "Username is required" });
      }
      if (nextUsername !== existing.username) {
        return reply.status(400).send({
          error: "Changing an endpoint username requires reconnecting with credentials",
        });
      }

      const nextSessionDuration =
        request.body.sessionDuration !== undefined
          ? resolveEndpointSessionDuration(request.body.sessionDuration)
          : existing.sessionDuration;

      const updated: EndpointEntry = {
        ...existing,
        url: nextUrl,
        label:
          request.body.label !== undefined
            ? defaultEndpointLabel(nextUrl, request.body.label)
            : existing.label,
        username: nextUsername,
        sessionDuration: nextSessionDuration
      };

      options.disposeEndpointSessions(endpointId);
      options.endpointSessions.upsertEndpoint(session.sessionId, updated);
      return reply.send(await validateEndpoint(updated, options.createClient));
    }
  );

  app.get("/auth/me", async (request, reply) => {
    const session = options.resolveSession(request, reply);
    if (!session) {
      return reply.send({ authenticated: false, endpoints: [] });
    }

    const endpoints = await listEndpointInfos(
      session,
      options.createClient,
      options.endpointPolicy,
    );
    return reply.send({
      authenticated: endpoints.some((endpoint) => endpoint.connected),
      endpoints
    });
  });

  app.post("/auth/logout", async (request, reply) => {
    const session = options.resolveSession(request, reply);
    if (session) {
      for (const endpointId of session.endpoints.keys()) {
        options.disposeEndpointSessions(endpointId);
      }
      options.endpointSessions.clearSession(session.sessionId);
    }

    clearSessionCookie(reply);
    clearLegacySessionCookies(reply);
    return reply.send({ success: true });
  });
}
