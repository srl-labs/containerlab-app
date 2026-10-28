import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type {
  EndpointKind,
  EndpointRuntimeInfo,
  LocalEndpointStatus
} from "@srl-labs/containerlab-app-contract";
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
  normalizeEndpointSessionDuration
} from "./endpointSessionStore.ts";
import { clearLegacySessionCookies, clearSessionCookie, normalizeApiUrl } from "./middleware.ts";

interface EndpointPublicInfo extends EndpointRuntimeInfo {
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
  /**
   * `local` adds a local lab host, the first one unless `url` names another
   * (`local://…`); it takes no credentials.
   */
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
  /** The app's local lab hosts; the first is this machine's by default. */
  localEndpoints: readonly AuthLocalEndpoint[];
  defaultApiUrl: string;
  disposeEndpointSessions: (endpointId: string) => void;
  ensureSession: (request: FastifyRequest, reply: FastifyReply) => EndpointSession;
  endpointSessions: EndpointSessionStore;
  resolveSession: (request: FastifyRequest, reply: FastifyReply) => EndpointSession | null;
}

/** A local lab host as the sign-in routes see it. */
interface AuthLocalEndpoint {
  url: string;
  autoConnect?: boolean;
  /** A cluster the user added in the app: listed even while its checks fail, to fix or remove it. */
  cluster?: unknown;
  status(): Promise<LocalEndpointStatus>;
}

/**
 * What a local lab host's own check says for its list entry: its runtime and
 * c9s settings, and its checks when it cannot run labs.
 */
function localStatusInfo(status: LocalEndpointStatus): EndpointRuntimeInfo {
  return {
    ...(status.runtime ? { runtime: status.runtime } : {}),
    ...(status.kubeContext ? { kubeContext: status.kubeContext } : {}),
    ...(status.kubeconfig ? { kubeconfig: status.kubeconfig } : {}),
    ...(status.namespace ? { namespace: status.namespace } : {}),
    ...(status.exposeType ? { exposeType: status.exposeType } : {}),
    ...(status.persistence !== undefined ? { persistence: status.persistence } : {}),
    ...(status.imagePullSecret ? { imagePullSecret: status.imagePullSecret } : {}),
    ...(status.editable === true ? { editable: true } : {}),
    ...(!status.available && status.checks ? { checks: status.checks } : {})
  };
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

/** The lab runtime of an endpoint for its badge; nothing when the host does not answer. */
async function runtimeInfo(backend: LabBackend): Promise<EndpointRuntimeInfo> {
  try {
    const profile = await backend.hostProfile();
    return {
      runtime: profile.runtime,
      ...(profile.kubeContext ? { kubeContext: profile.kubeContext } : {}),
      ...(profile.namespace ? { namespace: profile.namespace } : {}),
      ...(profile.cluster ? { cluster: profile.cluster } : {}),
      ...(profile.namespacePattern ? { namespacePattern: profile.namespacePattern } : {}),
      ...(profile.exposeType ? { exposeType: profile.exposeType } : {}),
      ...(profile.persistence !== undefined ? { persistence: profile.persistence } : {}),
      ...(profile.imagePullSecret ? { imagePullSecret: profile.imagePullSecret } : {}),
      ...(profile.updateRequired ? { updateRequired: profile.updateRequired } : {})
    };
  } catch {
    return {};
  }
}

async function validateEndpoint(
  entry: EndpointEntry,
  options: Pick<AuthRouteOptions, "backendFor" | "localEndpoints">
): Promise<EndpointPublicInfo> {
  if (entry.kind === "api" && !entry.token) return toPublicInfo(entry, "session_expired");
  const backend = options.backendFor(entry);
  if (!backend) return toPublicInfo(entry, "offline");
  const local = entry.kind === "local" ? options.localEndpoints.find((candidate) => candidate.url === entry.url) : undefined;
  if (local) {
    // A local host answers without a sign-in; its own check tells whether it can run labs.
    const status = await local.status().catch(() => undefined);
    if (status) {
      return { ...toPublicInfo(entry, status.available ? "connected" : "offline"), ...localStatusInfo(status) };
    }
  }
  try {
    await backend.version({ timeoutMs: 3000 });
    return { ...toPublicInfo(entry, "connected"), ...(await runtimeInfo(backend)) };
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
  options: Pick<AuthRouteOptions, "backendFor" | "localEndpoints">
): Promise<EndpointPublicInfo[]> {
  return await Promise.all(
    Array.from(session.endpoints.values(), (entry) => validateEndpoint(entry, options))
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

/** The local lab host at `url`, or the first one when no URL is given. */
function findLocalEndpoint(
  localEndpoints: readonly AuthLocalEndpoint[],
  url: string | undefined
): AuthLocalEndpoint | undefined {
  const requested = url?.trim();
  return requested ? localEndpoints.find((local) => local.url === requested) : localEndpoints[0];
}

/**
 * A local lab host in the session, added once per host: the app's own machine
 * (or a cluster it reaches) needs no sign-in, and its labs belong to the
 * app's OS user.
 */
async function addLocalEndpoint(
  body: { label?: string; url?: string },
  session: EndpointSession,
  options: Pick<AuthRouteOptions, "endpointSessions" | "localEndpoints">,
  endpointId?: string
): Promise<EndpointEntry> {
  const local = findLocalEndpoint(options.localEndpoints, body.url);
  if (!local) {
    throw Object.assign(
      new Error(
        options.localEndpoints.length === 0
          ? "This app cannot run labs on its own machine."
          : `This app has no local lab host ${body.url ?? ""}.`
      ),
      { status: 400 }
    );
  }
  const status = await local.status();
  if (!status.available && local.cluster === undefined) {
    throw Object.assign(new Error(status.problems.join(" ") || "containerlab cannot run here."), {
      status: 409
    });
  }
  const existing = Array.from(session.endpoints.values()).find(
    (entry) => entry.kind === "local" && entry.url === local.url
  );
  const entry: EndpointEntry = {
    id: existing?.id ?? endpointId ?? buildEndpointId(),
    kind: "local",
    url: local.url,
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
 * Connects the local lab hosts the first time a session asks for its
 * endpoints, when the app runs labs on its own machine by default and
 * containerlab is ready there. A host the user removed is left alone.
 */
export async function connectLocalEndpoint(
  request: FastifyRequest,
  reply: FastifyReply,
  options: Pick<AuthRouteOptions, "endpointSessions" | "ensureSession" | "localEndpoints" | "resolveSession">
): Promise<void> {
  const existing = options.resolveSession(request, reply);
  const candidates = options.localEndpoints.filter(
    (local) =>
      local.autoConnect === true &&
      !existing?.hiddenLocalUrls?.includes(local.url) &&
      !(existing && Array.from(existing.endpoints.values()).some((entry) => entry.kind === "local" && entry.url === local.url))
  );
  if (candidates.length === 0) return;
  // A cluster the user added stays listed while its checks fail, so it can be fixed there.
  const ready = (
    await Promise.all(
      candidates.map(async (local) => (local.cluster !== undefined || (await local.status()).available ? local : undefined))
    )
  ).filter((local): local is AuthLocalEndpoint => local !== undefined);
  if (ready.length === 0) return;
  const session = existing ?? options.ensureSession(request, reply);
  let pending = pendingLocalConnects.get(session);
  if (!pending) {
    pending = (async () => {
      for (const local of ready) {
        await addLocalEndpoint({ url: local.url }, session, options).catch(() => undefined);
      }
    })().finally(() => pendingLocalConnects.delete(session));
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
        return reply.send(await validateEndpoint(entry, options));
      }
      const entry = await authenticateEndpoint(request.body, options.defaultApiUrl);
      const session = options.ensureSession(request, reply);
      options.disposeEndpointSessions(entry.id);
      options.endpointSessions.upsertEndpoint(session.sessionId, entry);
      clearLegacySessionCookies(reply);
      // The runtime, so a freshly added lab host shows its badge right away.
      const backend = options.backendFor(entry);
      return reply.send({ ...toPublicInfo(entry, "connected"), ...(backend ? await runtimeInfo(backend) : {}) });
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

    return reply.send({ endpoints: await listEndpointInfos(session, options) });
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
        return reply.send(await validateEndpoint(local, options));
      }
      if (request.body.kind === "local") {
        // A saved local endpoint whose server session is gone comes back under its id.
        try {
          const session = options.ensureSession(request, reply);
          const entry = await addLocalEndpoint(request.body, session, options, endpointId);
          return reply.send(await validateEndpoint(entry, options));
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
        return reply.send(await validateEndpoint(updated, options));
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
      return reply.send(await validateEndpoint(updated, options));
    }
  );

  app.get("/auth/me", async (request, reply) => {
    await connectLocalEndpoint(request, reply, options);
    const session = options.resolveSession(request, reply);
    if (!session) {
      return reply.send({ authenticated: false, endpoints: [] });
    }

    const endpoints = await listEndpointInfos(session, options);
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
