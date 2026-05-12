import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type EndpointSessionDuration = string;

const ENDPOINT_SESSION_DURATION_PATTERN =
  /^(?:(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))|(?:\d+(?:\.\d+)?(?:d|w)))+$/i;

export const DEFAULT_ENDPOINT_SESSION_DURATION: EndpointSessionDuration = "24h";

export function normalizeEndpointSessionDuration(value: unknown): EndpointSessionDuration {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : DEFAULT_ENDPOINT_SESSION_DURATION;
}

export function isValidEndpointSessionDuration(value: string): boolean {
  return ENDPOINT_SESSION_DURATION_PATTERN.test(value.trim());
}

export interface EndpointEntry {
  id: string;
  url: string;
  label: string;
  token: string;
  username: string;
  sessionDuration: EndpointSessionDuration;
}

export interface EndpointSession {
  sessionId: string;
  endpoints: Map<string, EndpointEntry>;
  lastAccess: number;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function cloneEntries(entries: Iterable<EndpointEntry>): Map<string, EndpointEntry> {
  return new Map(Array.from(entries, (entry) => [entry.id, { ...entry }]));
}

export function buildEndpointId(): string {
  return `endpoint-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export interface EndpointSessionStore {
  clearSession(sessionId: string): void;
  dispose(): void;
  getSession(sessionId: string): EndpointSession | null;
  removeEndpoint(sessionId: string, endpointId: string): { removed: EndpointEntry | null; sessionEmpty: boolean };
  replaceSession(sessionId: string, entries: EndpointEntry[]): EndpointSession;
  upsertEndpoint(sessionId: string, entry: EndpointEntry): EndpointSession;
}

export interface EndpointSessionStoreOptions {
  persistenceFile?: string;
}

interface PersistedEndpointSession {
  endpoints: EndpointEntry[];
  lastAccess: number;
  sessionId: string;
}

interface PersistedEndpointSessionStore {
  sessions: PersistedEndpointSession[];
  version: 1;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEndpointEntry(value: unknown): value is EndpointEntry {
  return (
    isObject(value) &&
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.label === "string" &&
    typeof value.token === "string" &&
    typeof value.username === "string" &&
    typeof value.sessionDuration === "string" &&
    isValidEndpointSessionDuration(value.sessionDuration)
  );
}

function sessionIsExpired(session: EndpointSession, now = Date.now()): boolean {
  return now - session.lastAccess > SESSION_TTL_MS;
}

function serializeSessions(sessions: Iterable<EndpointSession>): PersistedEndpointSessionStore {
  return {
    version: 1,
    sessions: Array.from(sessions, (session) => ({
      sessionId: session.sessionId,
      lastAccess: session.lastAccess,
      endpoints: Array.from(session.endpoints.values(), (entry) => ({ ...entry }))
    }))
  };
}

function readPersistedSessions(persistenceFile: string | undefined): Map<string, EndpointSession> {
  const sessions = new Map<string, EndpointSession>();
  if (!persistenceFile) {
    return sessions;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(persistenceFile, "utf8"));
  } catch (error) {
    if (isObject(error) && error.code === "ENOENT") {
      return sessions;
    }
    return sessions;
  }

  if (!isObject(parsed) || !Array.isArray(parsed.sessions)) {
    return sessions;
  }

  for (const persistedSession of parsed.sessions) {
    if (
      !isObject(persistedSession) ||
      typeof persistedSession.sessionId !== "string" ||
      typeof persistedSession.lastAccess !== "number" ||
      !Number.isFinite(persistedSession.lastAccess) ||
      !Array.isArray(persistedSession.endpoints)
    ) {
      continue;
    }

    const endpoints = persistedSession.endpoints.filter(isEndpointEntry);
    const session: EndpointSession = {
      sessionId: persistedSession.sessionId,
      endpoints: cloneEntries(endpoints),
      lastAccess: persistedSession.lastAccess
    };
    if (!sessionIsExpired(session)) {
      sessions.set(session.sessionId, session);
    }
  }

  return sessions;
}

function writePersistedSessions(
  persistenceFile: string | undefined,
  sessions: Iterable<EndpointSession>
): void {
  if (!persistenceFile) {
    return;
  }

  const payload = JSON.stringify(serializeSessions(sessions), null, 2);
  const temporaryFile = `${persistenceFile}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(persistenceFile), { mode: 0o700, recursive: true });
    fs.writeFileSync(temporaryFile, payload, { encoding: "utf8", mode: 0o600 });
    fs.chmodSync(temporaryFile, 0o600);
    fs.renameSync(temporaryFile, persistenceFile);
    fs.chmodSync(persistenceFile, 0o600);
  } catch {
    try {
      fs.rmSync(temporaryFile, { force: true });
    } catch {
      // Best-effort cleanup only.
    }
  }
}

export function createEndpointSessionStore(
  options: EndpointSessionStoreOptions = {}
): EndpointSessionStore {
  const sessions = readPersistedSessions(options.persistenceFile);

  const persistSessions = (): void => {
    writePersistedSessions(options.persistenceFile, sessions.values());
  };

  const cleanupExpiredSessions = (): void => {
    const now = Date.now();
    let changed = false;
    for (const [sessionId, session] of sessions.entries()) {
      if (!sessionIsExpired(session, now)) {
        continue;
      }
      sessions.delete(sessionId);
      changed = true;
    }
    if (changed) {
      persistSessions();
    }
  };

  const cleanupTimer = setInterval(cleanupExpiredSessions, 60_000);

  function touch(session: EndpointSession): EndpointSession {
    session.lastAccess = Date.now();
    return session;
  }

  return {
    clearSession(sessionId) {
      sessions.delete(sessionId);
      persistSessions();
    },

    dispose() {
      clearInterval(cleanupTimer);
      sessions.clear();
    },

    getSession(sessionId) {
      const session = sessions.get(sessionId);
      return session ? touch(session) : null;
    },

    removeEndpoint(sessionId, endpointId) {
      const session = sessions.get(sessionId);
      if (!session) {
        return { removed: null, sessionEmpty: true };
      }

      const removed = session.endpoints.get(endpointId) ?? null;
      if (removed) {
        session.endpoints.delete(endpointId);
      }

      if (session.endpoints.size === 0) {
        sessions.delete(sessionId);
        persistSessions();
        return { removed, sessionEmpty: true };
      }

      touch(session);
      persistSessions();
      return { removed, sessionEmpty: false };
    },

    replaceSession(sessionId, entries) {
      const session: EndpointSession = {
        sessionId,
        endpoints: cloneEntries(entries),
        lastAccess: Date.now()
      };
      sessions.set(sessionId, session);
      persistSessions();
      return session;
    },

    upsertEndpoint(sessionId, entry) {
      const existing = sessions.get(sessionId);
      if (!existing) {
        return this.replaceSession(sessionId, [entry]);
      }

      const nextEndpoints = new Map(existing.endpoints);
      nextEndpoints.set(entry.id, { ...entry });
      existing.endpoints = nextEndpoints;
      touch(existing);
      persistSessions();
      return existing;
    }
  };
}
