import {
  TopologySessionCore,
  type createRuntimeContainerDataProvider,
  type TopologyRef
} from "@srl-labs/clab-ui/session";

import { ClabApiFileSystemAdapter } from "./clabApiFileSystem.ts";
import type { ClabApiClient } from "./clabApiClient.ts";

type ContainerDataProvider = ReturnType<typeof createRuntimeContainerDataProvider>;
type DeploymentState = "deployed" | "undeployed" | "unknown";
type TopologySourcePreference = "api-file" | "running-lab-doc";
type DirtyContextHost = {
  updateContext(context: { dirty: boolean | undefined }): void;
};

interface SessionRecord {
  baseUrl: string;
  endpointId: string;
  host: TopologySessionCore;
  isInternalUpdate(): boolean;
  lastAccess: number;
  sessionId: string;
  sourcePreference: TopologySourcePreference;
  token: string;
  topologyRef: TopologyRef;
  disposeInternalUpdateTracker(): void;
}

interface CreateSessionOptions {
  client: ClabApiClient;
  containerDataProvider: ContainerDataProvider;
  deploymentState: DeploymentState;
  endpointId: string;
  mode: "edit" | "view";
  sourcePreference?: TopologySourcePreference;
  token: string;
  topologyRef: TopologyRef;
}

const SESSION_TTL_MS = 5 * 60 * 1000;
const INTERNAL_UPDATE_GRACE_MS = 250;

interface InternalUpdateTracker {
  dispose(): void;
  isActive(): boolean;
  set(updating: boolean): void;
}

export interface StandaloneTopologySessionManager {
  createSession(options: CreateSessionOptions): SessionRecord;
  disposeAll(): void;
  disposeSessionsForEndpoint(endpointId: string): void;
  disposeSession(sessionId: string): boolean;
  disposeSessionsForToken(token: string, baseUrl?: string): void;
  getSession(sessionId: string, endpointId?: string): SessionRecord | null;
  /**
   * Update the topology sync (dirty) state on every session that edits the
   * given lab, so later snapshots report it to the webview.
   */
  setDirtyForTopology(
    target: { endpointId?: string; labName?: string; yamlPath?: string },
    dirty: boolean | undefined
  ): void;
}

function createInternalUpdateTracker(): InternalUpdateTracker {
  let internalUpdateDepth = 0;
  let internalUpdateGraceUntil = 0;
  let internalUpdateGraceTimer: ReturnType<typeof setTimeout> | undefined;

  const clearGraceTimer = (): void => {
    if (!internalUpdateGraceTimer) {
      return;
    }
    clearTimeout(internalUpdateGraceTimer);
    internalUpdateGraceTimer = undefined;
  };

  const startGraceWindow = (): void => {
    internalUpdateGraceUntil = Date.now() + INTERNAL_UPDATE_GRACE_MS;
    clearGraceTimer();
    internalUpdateGraceTimer = setTimeout(() => {
      internalUpdateGraceUntil = 0;
      internalUpdateGraceTimer = undefined;
    }, INTERNAL_UPDATE_GRACE_MS);
  };

  return {
    dispose(): void {
      internalUpdateDepth = 0;
      internalUpdateGraceUntil = 0;
      clearGraceTimer();
    },

    isActive(): boolean {
      return internalUpdateDepth > 0 || Date.now() < internalUpdateGraceUntil;
    },

    set(updating: boolean): void {
      if (updating) {
        clearGraceTimer();
        internalUpdateGraceUntil = 0;
        internalUpdateDepth += 1;
        return;
      }

      const hadActiveInternalUpdate = internalUpdateDepth > 0;
      internalUpdateDepth = Math.max(0, internalUpdateDepth - 1);
      if (!hadActiveInternalUpdate || internalUpdateDepth > 0) {
        return;
      }

      startGraceWindow();
    }
  };
}

export function createStandaloneTopologySessionManager(): StandaloneTopologySessionManager {
  const sessions = new Map<string, SessionRecord>();

  const disposeSessionRecord = (session: SessionRecord): void => {
    session.host.dispose();
    session.disposeInternalUpdateTracker();
  };

  const cleanupExpiredSessions = (): void => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
      if (now - session.lastAccess <= SESSION_TTL_MS) {
        continue;
      }
      disposeSessionRecord(session);
      sessions.delete(sessionId);
    }
  };

  const cleanupTimer = setInterval(cleanupExpiredSessions, 60_000);

  const disposeSession = (sessionId: string): boolean => {
    const session = sessions.get(sessionId);
    if (!session) {
      return false;
    }
    disposeSessionRecord(session);
    sessions.delete(sessionId);
    return true;
  };

  return {
    createSession(options) {
      const sessionId = globalThis.crypto.randomUUID();
      const fs = new ClabApiFileSystemAdapter({
        client: options.client,
        token: options.token,
        labName: options.topologyRef.labName,
        sourcePreference: options.sourcePreference ?? "api-file",
        yamlPath: options.topologyRef.yamlPath,
        annotationsPath: options.topologyRef.annotationsPath
      });
      const internalUpdateTracker = createInternalUpdateTracker();

      const host = new TopologySessionCore({
        fs,
        yamlFilePath: options.topologyRef.yamlPath,
        mode: options.mode,
        deploymentState: options.deploymentState,
        containerDataProvider: options.containerDataProvider,
        setInternalUpdate: internalUpdateTracker.set,
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: console.error
        }
      });

      const record: SessionRecord = {
        baseUrl: options.client.getBaseUrl(),
        endpointId: options.endpointId,
        host,
        isInternalUpdate: internalUpdateTracker.isActive,
        lastAccess: Date.now(),
        sessionId,
        sourcePreference: options.sourcePreference ?? "api-file",
        token: options.token,
        topologyRef: options.topologyRef,
        disposeInternalUpdateTracker: internalUpdateTracker.dispose
      };

      sessions.set(sessionId, record);
      return record;
    },

    disposeAll() {
      clearInterval(cleanupTimer);
      for (const session of sessions.values()) {
        disposeSessionRecord(session);
      }
      sessions.clear();
    },

    disposeSession,

    disposeSessionsForEndpoint(endpointId) {
      for (const [sessionId, session] of sessions.entries()) {
        if (session.endpointId !== endpointId) {
          continue;
        }
        disposeSession(sessionId);
      }
    },

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

    getSession(sessionId, endpointId) {
      const session = sessions.get(sessionId);
      if (!session) {
        return null;
      }
      if (endpointId && session.endpointId !== endpointId) {
        return null;
      }
      session.lastAccess = Date.now();
      return session;
    },

    setDirtyForTopology(target, dirty) {
      const normalizedLabName = target.labName?.trim().toLowerCase() ?? "";
      const normalizedYamlPath = normalizePath(target.yamlPath);
      if (!normalizedLabName && !normalizedYamlPath) {
        return;
      }

      for (const session of sessions.values()) {
        if (target.endpointId && session.endpointId !== target.endpointId) {
          continue;
        }
        const sessionLabName = session.topologyRef.labName.trim().toLowerCase();
        const sessionYamlPath = normalizePath(session.topologyRef.yamlPath);
        const matchesPath =
          normalizedYamlPath.length > 0 && sessionYamlPath === normalizedYamlPath;
        const matchesLabName =
          normalizedLabName.length > 0 && sessionLabName === normalizedLabName;
        if (!matchesPath && !matchesLabName) {
          continue;
        }
        (session.host as unknown as DirtyContextHost).updateContext({ dirty });
      }
    }
  };
}

function normalizePath(pathValue: string | undefined): string {
  return (pathValue ?? "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}
