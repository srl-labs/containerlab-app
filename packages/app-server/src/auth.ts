import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { EndpointKind, LocalEndpointStatus } from "@srl-labs/containerlab-app-contract";
import type { LabBackend } from "@srl-labs/containerlab-lab-backend";
import { ApiLabBackend } from "@srl-labs/containerlab-lab-backend/api";

import type {
  EndpointEntry,
  EndpointSession,
  EndpointSessionDuration,
  EndpointSessionStore
} from "./endpointSessionStore.ts";
import {
  buildEndpointId,
  DEFAULT_ENDPOINT_SESSION_DURATION,
  isValidEndpointSessionDuration,
  LOCAL_ENDPOINT_URL,
  normalizeEndpointSessionDuration
} from "./endpointSessionStore.ts";
import { clearLegacySessionCookies, clearSessionCookie, normalizeApiUrl } from "./middleware.ts";

interface EndpointPublicInfo {
  id: string;
  kind: EndpointKind;
  url: string;
  label: string;
  username: string;
  sessionDuration: EndpointSessionDuration;
  status: "connected" | "session_expired" | "offline";
  connected: boolean;
}

interface AddEndpointBody {
  /** `local` adds the "This computer" endpoint; it takes no URL or credentials. */
  kind?: EndpointKind;
  label?: string;
  password: string;
  sessionDuration?: EndpointSessionDuration;
  url?: string;
  username: string;
  apiUrl?: string;
}

interface ReconnectEndpointBody {
  kind?: EndpointKind;
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
  /** The backend of a signed-in endpoint; null for a local endpoint this app does not offer. */
  backendFor: (entry: EndpointEntry) => LabBackend | null;
  localEndpoint?: { autoConnect?: boolean; status(): Promise<LocalEndpointStatus> };
  defaultApiUrl: string;
  disposeEndpointSessions: (endpointId: string) => void;
  ensureSession: (request: FastifyRequest, reply: FastifyReply) => EndpointSession;
  endpointSessions: EndpointSessionStore;
  resolveSession: (request: FastifyRequest, reply: FastifyReply) => EndpointSession | null;
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
    kind: entry.kind,
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
  backendFor: AuthRouteOptions["backendFor"]
): Promise<EndpointPublicInfo> {
  if (entry.kind === "api" && !entry.token) return toPublicInfo(entry, "session_expired");
  const backend = backendFor(entry);
  if (!backend) return toPublicInfo(entry, "offline");
  try {
    await backend.version({ timeoutMs: 3000 });
    return toPublicInfo(entry, "connected");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "status" in error &&
      ((error as { status?: unknown }).status === 401 ||
        (error as { status?: unknown }).status === 403)
    ) {
      return toPublicInfo(entry, "session_expired");
    }
    return toPublicInfo(entry, "offline");
  }
}

async function listEndpointInfos(
  session: EndpointSession,
  backendFor: AuthRouteOptions["backendFor"]
): Promise<EndpointPublicInfo[]> {
  return await Promise.all(
    Array.from(session.endpoints.values(), (entry) => validateEndpoint(entry, backendFor))
  );
}

function requireCredentials(
  username: string | undefined,
  password: string | undefined
): string | null {
  if (!username?.trim() || !password?.trim()) {
    return "Username and password are required";
  }
  return null;
}

function authErrorStatusCode(error: unknown): number {
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
    ((error as { status?: unknown }).status === 400 ||
      (error as { status?: unknown }).status === 401 ||
      (error as { status?: unknown }).status === 403 ||
      (error as { status?: unknown }).status === 409)
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
  defaultApiUrl: string
): Promise<EndpointEntry> {
  const username = body.username?.trim() ?? "";
  const password = body.password;
  const sessionDuration = resolveEndpointSessionDuration(body.sessionDuration);
  const credentialError = requireCredentials(username, password);
  if (credentialError) {
    throw new Error(credentialError);
  }

  const rawUrl = body.url ?? body.apiUrl ?? defaultApiUrl;
  const normalizedUrl = normalizeApiUrl(rawUrl);
  if (!normalizedUrl) {
    throw new Error("Invalid API endpoint URL");
  }

  const backend = await ApiLabBackend.login({
    baseUrl: normalizedUrl,
    username,
    password,
    sessionDuration
  });

  return {
    id: buildEndpointId(),
    kind: "api",
    url: normalizedUrl,
    label: defaultEndpointLabel(normalizedUrl, body.label),
    token: backend.token,
    username,
    sessionDuration
  };
}

async function reconnectEndpoint(
  endpointId: string,
  body: ReconnectEndpointBody,
  session: EndpointSession,
  options: AuthRouteOptions
): Promise<EndpointEntry> {
  const existing = session.endpoints.get(endpointId) ?? null;
  const rawUrl = existing?.url ?? body.url;
  const normalizedUrl = rawUrl ? normalizeApiUrl(rawUrl) : null;
  if (!normalizedUrl) {
    throw new Error("Endpoint URL is required to reconnect");
  }

  const sessionDuration = resolveEndpointSessionDuration(
    body.sessionDuration ?? existing?.sessionDuration
  );
  const backend = await ApiLabBackend.login({
    baseUrl: normalizedUrl,
    username: body.username.trim(),
    password: body.password,
    sessionDuration
  });
  const updated: EndpointEntry = {
    id: endpointId || existing?.id || buildEndpointId(),
    kind: "api",
    url: normalizedUrl,
    label: defaultEndpointLabel(normalizedUrl, body.label ?? existing?.label),
    token: backend.token,
    username: body.username.trim(),
    sessionDuration
  };
  options.disposeEndpointSessions(endpointId);
  options.endpointSessions.upsertEndpoint(session.sessionId, updated);
  return updated;
}

/**
 * The session's local endpoint, added once: the app's own machine needs no
 * sign-in, and its labs belong to the app's OS user.
 */
async function addLocalEndpoint(
  body: { label?: string },
  session: EndpointSession,
  options: Pick<AuthRouteOptions, "endpointSessions" | "localEndpoint">,
  endpointId?: string
): Promise<EndpointEntry> {
  if (!options.localEndpoint) {
    throw Object.assign(new Error("This app cannot run labs on its own machine."), { status: 400 });
  }
  const status = await options.localEndpoint.status();
  if (!status.available) {
    throw Object.assign(new Error(status.problems.join(" ") || "containerlab cannot run here."), {
      status: 409
    });
  }
  const existing = Array.from(session.endpoints.values()).find((entry) => entry.kind === "local");
  const entry: EndpointEntry = {
    id: existing?.id ?? endpointId ?? buildEndpointId(),
    kind: "local",
    url: LOCAL_ENDPOINT_URL,
    label: body.label?.trim() || existing?.label || status.label,
    token: "",
    username: status.username,
    sessionDuration: existing?.sessionDuration ?? DEFAULT_ENDPOINT_SESSION_DURATION
  };
  options.endpointSessions.upsertEndpoint(session.sessionId, entry);
  return entry;
}

const pendingLocalConnects = new WeakMap<EndpointSession, Promise<void>>();

/**
 * Connects the local endpoint the first time a session asks for its
 * endpoints, when the app runs labs on its own machine by default and
 * containerlab is ready. A session whose user removed it is left alone.
 */
export async function connectLocalEndpoint(
  request: FastifyRequest,
  reply: FastifyReply,
  options: Pick<AuthRouteOptions, "endpointSessions" | "ensureSession" | "localEndpoint" | "resolveSession">
): Promise<void> {
  if (!options.localEndpoint?.autoConnect) return;
  const existing = options.resolveSession(request, reply);
  if (existing?.localHidden) return;
  if (existing && Array.from(existing.endpoints.values()).some((entry) => entry.kind === "local")) {
    return;
  }
  const status = await options.localEndpoint.status();
  if (!status.available) return;
  const session = existing ?? options.ensureSession(request, reply);
  let pending = pendingLocalConnects.get(session);
  if (!pending) {
    pending = addLocalEndpoint({}, session, options)
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => pendingLocalConnects.delete(session));
    pendingLocalConnects.set(session, pending);
  }
  await pending;
}

export function registerAuthRoutes(app: FastifyInstance, options: AuthRouteOptions): void {
  app.post<{ Body: AddEndpointBody }>("/auth/endpoints/add", async (request, reply) => {
    try {
      if (request.body.kind === "local") {
        const session = options.ensureSession(request, reply);
        const entry = await addLocalEndpoint(request.body, session, options);
        return reply.send(await validateEndpoint(entry, options.backendFor));
      }
      const entry = await authenticateEndpoint(request.body, options.defaultApiUrl);
      const session = options.ensureSession(request, reply);
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
      const entry = await authenticateEndpoint(request.body, options.defaultApiUrl);
      const session = options.ensureSession(request, reply);
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
    await connectLocalEndpoint(request, reply, options);
    const session = options.resolveSession(request, reply);
    if (!session) {
      return reply.send({ endpoints: [] });
    }

    return reply.send({ endpoints: await listEndpointInfos(session, options.backendFor) });
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

    const backend = options.backendFor(endpoint);
    if (!backend) {
      return reply.status(404).send({ error: "Endpoint not available" });
    }
    try {
      return reply.send(await backend.healthMetrics());
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
      const local = options.resolveSession(request, reply)?.endpoints.get(endpointId);
      if (local?.kind === "local") {
        // Nothing to sign in to: report whether containerlab answers again.
        return reply.send(await validateEndpoint(local, options.backendFor));
      }
      if (request.body.kind === "local") {
        // A saved local endpoint whose server session is gone comes back under its id.
        try {
          const session = options.ensureSession(request, reply);
          const entry = await addLocalEndpoint(request.body, session, options, endpointId);
          return reply.send(await validateEndpoint(entry, options.backendFor));
        } catch (error) {
          const message = error instanceof Error ? error.message : "Reconnect failed";
          return reply.status(authErrorStatusCode(error)).send({ error: message });
        }
      }
      const credentialError = requireCredentials(request.body.username, request.body.password);
      if (credentialError) {
        return reply.status(400).send({ error: credentialError });
      }

      try {
        const session = options.ensureSession(request, reply);
        const updated = await reconnectEndpoint(endpointId, request.body, session, options);
        clearLegacySessionCookies(reply);
        return reply.send(toPublicInfo(updated, updated.token ? "connected" : "session_expired"));
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
        return reply.send(
          toPublicInfo(updated, updated.kind === "local" || updated.token ? "connected" : "session_expired")
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to update endpoint preferences";
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

      if (existing.kind === "local") {
        const updated: EndpointEntry = {
          ...existing,
          label: request.body.label?.trim() || existing.label,
          sessionDuration:
            request.body.sessionDuration !== undefined
              ? resolveEndpointSessionDuration(request.body.sessionDuration)
              : existing.sessionDuration
        };
        options.endpointSessions.upsertEndpoint(session.sessionId, updated);
        return reply.send(await validateEndpoint(updated, options.backendFor));
      }

      const nextUrl =
        request.body.url !== undefined ? normalizeApiUrl(request.body.url) : existing.url;
      if (!nextUrl) {
        return reply.status(400).send({ error: "Invalid API endpoint URL" });
      }

      const nextUsername =
        request.body.username !== undefined ? request.body.username.trim() : existing.username;
      if (!nextUsername) {
        return reply.status(400).send({ error: "Username is required" });
      }

      const nextSessionDuration =
        request.body.sessionDuration !== undefined
          ? resolveEndpointSessionDuration(request.body.sessionDuration)
          : existing.sessionDuration;

      const identityChanged = nextUrl !== existing.url || nextUsername !== existing.username;
      const updated: EndpointEntry = {
        ...existing,
        token: identityChanged ? "" : existing.token,
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
      return reply.send(await validateEndpoint(updated, options.backendFor));
    }
  );

  app.get("/auth/me", async (request, reply) => {
    await connectLocalEndpoint(request, reply, options);
    const session = options.resolveSession(request, reply);
    if (!session) {
      return reply.send({ authenticated: false, endpoints: [] });
    }

    const endpoints = await listEndpointInfos(session, options.backendFor);
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
