import {
  TopologySessionCore,
  createRuntimeContainerDataProvider,
  type TopologyRef
} from "@srl-labs/clab-ui/session";

import { ClabApiFileSystemAdapter } from "./clabApiFileSystem.js";
import type { ClabApiClient } from "./clabApiClient.js";

type ContainerDataProvider = ReturnType<typeof createRuntimeContainerDataProvider>;
type DeploymentState = "deployed" | "undeployed" | "unknown";

interface SessionRecord {
  baseUrl: string;
  host: TopologySessionCore;
  lastAccess: number;
  sessionId: string;
  token: string;
  topologyRef: TopologyRef;
}

interface CreateSessionOptions {
  client: ClabApiClient;
  containerDataProvider: ContainerDataProvider;
  deploymentState: DeploymentState;
  mode: "edit" | "view";
  token: string;
  topologyRef: TopologyRef;
}

const SESSION_TTL_MS = 5 * 60 * 1000;

export interface StandaloneTopologySessionManager {
  createSession(options: CreateSessionOptions): SessionRecord;
  disposeAll(): void;
  disposeSession(sessionId: string): boolean;
  disposeSessionsForToken(token: string, baseUrl?: string): void;
  getSession(sessionId: string, token: string, baseUrl: string): SessionRecord | null;
}

export function createStandaloneTopologySessionManager(): StandaloneTopologySessionManager {
  const sessions = new Map<string, SessionRecord>();

  const cleanupExpiredSessions = (): void => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
      if (now - session.lastAccess <= SESSION_TTL_MS) {
        continue;
      }
      session.host.dispose();
      sessions.delete(sessionId);
    }
  };

  const cleanupTimer = setInterval(cleanupExpiredSessions, 60_000);

  const disposeSession = (sessionId: string): boolean => {
    const session = sessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.host.dispose();
    sessions.delete(sessionId);
    return true;
  };

  return {
    createSession(options) {
      const sessionId = globalThis.crypto.randomUUID();
      const fs = new ClabApiFileSystemAdapter({
        client: options.client,
        token: options.token,
        labName: options.topologyRef.labName
      });

      const host = new TopologySessionCore({
        fs,
        yamlFilePath: options.topologyRef.yamlPath,
        mode: options.mode,
        deploymentState: options.deploymentState,
        containerDataProvider: options.containerDataProvider,
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: console.error
        }
      });

      const record: SessionRecord = {
        baseUrl: options.client.getBaseUrl(),
        host,
        lastAccess: Date.now(),
        sessionId,
        token: options.token,
        topologyRef: options.topologyRef
      };

      sessions.set(sessionId, record);
      return record;
    },

    disposeAll() {
      clearInterval(cleanupTimer);
      for (const session of sessions.values()) {
        session.host.dispose();
      }
      sessions.clear();
    },

    disposeSession,

    disposeSessionsForToken(token, baseUrl) {
      for (const [sessionId, session] of sessions.entries()) {
        if (session.token !== token) {
          continue;
        }
        if (baseUrl && session.baseUrl !== baseUrl) {
          continue;
        }
        disposeSession(sessionId);
      }
    },

    getSession(sessionId, token, baseUrl) {
      const session = sessions.get(sessionId);
      if (!session) {
        return null;
      }
      if (session.token !== token || session.baseUrl !== baseUrl) {
        return null;
      }
      session.lastAccess = Date.now();
      return session;
    }
  };
}
