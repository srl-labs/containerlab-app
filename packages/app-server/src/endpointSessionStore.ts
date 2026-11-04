import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { isValidEndpointSessionDuration } from "@srl-labs/containerlab-app-contract";
import type { EndpointKind, EndpointSessionDuration } from "@srl-labs/containerlab-app-contract";
export {
  DEFAULT_ENDPOINT_SESSION_DURATION,
  normalizeEndpointSessionDuration,
  isValidEndpointSessionDuration
} from "@srl-labs/containerlab-app-contract";
export type { EndpointSessionDuration } from "@srl-labs/containerlab-app-contract";

export interface EndpointEntry {
  id: string;
  /** A local endpoint has no URL to sign in to and no token. */
  kind: EndpointKind;
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
  /**
   * The local lab hosts (by `local://` URL) the user removed, so they are not
   * connected again by themselves.
   */
  hiddenLocalUrls?: string[];
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The address this machine's local endpoint shows in place of an API URL. */
export const LOCAL_ENDPOINT_URL = "local://this-computer";

/**
 * The address of a local c9s lab host: one per kubeconfig context, and per
 * kubeconfig file when the host names one (the same context name in two
 * files can be two clusters).
 */
export function c9sLocalEndpointUrl(kubeContext: string | undefined, kubeconfig?: string): string {
  const url = `local://c9s/${encodeURIComponent(kubeContext ?? "current-context")}`;
  return kubeconfig ? `${url}?kubeconfig=${encodeURIComponent(kubeconfig)}` : url;
}

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
  removeEndpoint(
    sessionId: string,
    endpointId: string
  ): { removed: EndpointEntry | null; sessionEmpty: boolean };
  replaceSession(sessionId: string, entries: EndpointEntry[]): EndpointSession;
  upsertEndpoint(sessionId: string, entry: EndpointEntry): EndpointSession;
}

export interface EndpointSessionStoreOptions {
  persistenceFile?: string;
}

interface PersistedEndpointSession {
  endpoints: EndpointEntry[];
  lastAccess: number;
  hiddenLocalUrls?: string[];
  /** Sessions from before several local lab hosts: the user removed this computer. */
  localHidden?: boolean;
  sessionId: string;
}

interface PersistedEndpointSessionStore {
  sessions: PersistedEndpointSession[];
  version: 1;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** A stored endpoint; entries saved before endpoint kinds existed are API endpoints. */
function toEndpointEntry(value: unknown): EndpointEntry | null {
  if (!isEndpointRecord(value)) return null;
  const kind = value.kind === "local" ? "local" : "api";
  return { ...value, kind } as EndpointEntry;
}

function isEndpointRecord(value: unknown): value is Omit<EndpointEntry, "kind"> & { kind?: unknown } {
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
      ...(session.hiddenLocalUrls?.length ? { hiddenLocalUrls: [...session.hiddenLocalUrls] } : {}),
      endpoints: Array.from(session.endpoints.values(), (entry) => ({
        ...entry
      }))
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

    const endpoints = persistedSession.endpoints
      .map(toEndpointEntry)
      .filter((entry): entry is EndpointEntry => entry !== null);
    const hidden = Array.isArray(persistedSession.hiddenLocalUrls)
      ? persistedSession.hiddenLocalUrls.filter((url): url is string => typeof url === "string")
      : [];
    if (persistedSession.localHidden === true && !hidden.includes(LOCAL_ENDPOINT_URL)) {
      hidden.push(LOCAL_ENDPOINT_URL);
    }
    const session: EndpointSession = {
      sessionId: persistedSession.sessionId,
      endpoints: cloneEntries(endpoints),
      lastAccess: persistedSession.lastAccess,
      ...(hidden.length > 0 ? { hiddenLocalUrls: hidden } : {})
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
    fs.mkdirSync(path.dirname(persistenceFile), {
      mode: 0o700,
      recursive: true
    });
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
      if (removed?.kind === "local") {
        // Remember the choice: the session outlives its last endpoint for that.
        session.hiddenLocalUrls = Array.from(new Set([...(session.hiddenLocalUrls ?? []), removed.url]));
      }

      if (session.endpoints.size === 0 && !session.hiddenLocalUrls?.length) {
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
      if (entry.kind === "local" && existing.hiddenLocalUrls) {
        existing.hiddenLocalUrls = existing.hiddenLocalUrls.filter((url) => url !== entry.url);
        if (existing.hiddenLocalUrls.length === 0) delete existing.hiddenLocalUrls;
      }
      touch(existing);
      persistSessions();
      return existing;
    }
  };
}
