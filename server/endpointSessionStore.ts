import { randomUUID } from "node:crypto";

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

export function createEndpointSessionStore(): EndpointSessionStore {
  const sessions = new Map<string, EndpointSession>();

  const cleanupExpiredSessions = (): void => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
      if (now - session.lastAccess <= SESSION_TTL_MS) {
        continue;
      }
      sessions.delete(sessionId);
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
        return { removed, sessionEmpty: true };
      }

      touch(session);
      return { removed, sessionEmpty: false };
    },

    replaceSession(sessionId, entries) {
      const session: EndpointSession = {
        sessionId,
        endpoints: cloneEntries(entries),
        lastAccess: Date.now()
      };
      sessions.set(sessionId, session);
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
      return touch(existing);
    }
  };
}
