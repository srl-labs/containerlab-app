/**
 * TopologyHost command helpers.
 *
 * Wraps host command dispatch with revision/snapshot handling.
 */

import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "../core/types/messages";
import type { TopologySessionClient } from "../session/client";
import { getRecordUnknown } from "../core/utilities/typeHelpers";
import { useTopoViewerStore } from "../stores/topoViewerStore";

import { enqueueHostCommand } from "./topologyHostQueue";
import { applySnapshotToStores } from "./topologyHostSync";

const HOST_ACK = "topology-host:ack" as const;
const HOST_REJECT = "topology-host:reject" as const;

interface ExecuteOptions {
  applySnapshot?: boolean;
}

function isVoidCallback(value: unknown): value is () => void {
  return typeof value === "function";
}

function getDevHostUpdateHandler(): (() => void) | undefined {
  if (typeof window === "undefined") return undefined;
  const dev = getRecordUnknown(getRecordUnknown(window)?.__DEV__) ?? {};
  const handler = dev.onHostUpdate;
  if (!isVoidCallback(handler)) {
    return undefined;
  }
  return handler;
}

function notifyDevHostUpdate(): void {
  getDevHostUpdateHandler()?.();
}

async function handleHostResponse(
  response: TopologyHostResponseMessage,
  applySnapshot: boolean,
  client: TopologySessionClient
): Promise<TopologyHostResponseMessage> {
  const syncUndoRedo = (snapshot: TopologySnapshot) => {
    useTopoViewerStore.getState().setInitialData({
      canUndo: snapshot.canUndo,
      canRedo: snapshot.canRedo
    });
  };

  const syncSource = (snapshot: TopologySnapshot) => {
    useTopoViewerStore.getState().setInitialData({
      yamlFileName: snapshot.yamlFileName,
      annotationsFileName: snapshot.annotationsFileName,
      yamlContent: snapshot.yamlContent,
      annotationsContent: snapshot.annotationsContent,
      documentRevision: snapshot.documentRevision ?? ""
    });
  };

  const applySnapshotAndNotify = (snapshot: TopologySnapshot) => {
    applySnapshotToStores(snapshot, {}, client);
    notifyDevHostUpdate();
  };

  const setRevisionAndNotify = (revision: number, snapshot?: TopologySnapshot) => {
    client.setRevision(revision);
    if (snapshot) {
      syncUndoRedo(snapshot);
      // Even when applySnapshot=false (quiet updates), keep source editors in sync.
      syncSource(snapshot);
    }
    notifyDevHostUpdate();
  };

  switch (response.type) {
    case HOST_ACK:
      return handleAckResponse(
        response,
        applySnapshot,
        applySnapshotAndNotify,
        setRevisionAndNotify,
        client
      );
    case HOST_REJECT:
      return handleRejectResponse(
        response,
        applySnapshot,
        applySnapshotAndNotify,
        setRevisionAndNotify,
        client
      );
    case "topology-host:error":
      throw new Error(response.error);
    default:
      return response;
  }
}

async function handleAckResponse(
  response: TopologyHostResponseMessage,
  applySnapshot: boolean,
  applySnapshotAndNotify: (snapshot: TopologySnapshot) => void,
  setRevisionAndNotify: (revision: number, snapshot?: TopologySnapshot) => void,
  client: TopologySessionClient
): Promise<TopologyHostResponseMessage> {
  if (response.type !== HOST_ACK) return response;

  if (response.snapshot) {
    if (applySnapshot) {
      applySnapshotAndNotify(response.snapshot);
    } else {
      setRevisionAndNotify(response.snapshot.revision, response.snapshot);
    }
    return response;
  }

  if (applySnapshot) {
    const snapshot = await client.requestSnapshot({});
    applySnapshotAndNotify(snapshot);
    return response;
  }

  setRevisionAndNotify(response.revision);
  return response;
}

function handleRejectResponse(
  response: TopologyHostResponseMessage,
  applySnapshot: boolean,
  applySnapshotAndNotify: (snapshot: TopologySnapshot) => void,
  setRevisionAndNotify: (revision: number, snapshot?: TopologySnapshot) => void,
  _client: TopologySessionClient
): TopologyHostResponseMessage {
  if (response.type !== HOST_REJECT) return response;

  if (applySnapshot) {
    applySnapshotAndNotify(response.snapshot);
  } else {
    setRevisionAndNotify(response.snapshot.revision, response.snapshot);
  }
  return response;
}

export async function executeTopologyCommand(
  command: TopologyHostCommand,
  options: ExecuteOptions = {},
  client: TopologySessionClient
): Promise<TopologyHostResponseMessage> {
  if (useTopoViewerStore.getState().isProcessing) {
    throw new Error("TopoViewer is processing; edits are temporarily disabled.");
  }
  const run = async () => {
    const applySnapshot = options.applySnapshot ?? true;
    const response = await client.dispatchCommand(command);
    return handleHostResponse(response, applySnapshot, client);
  };
  return enqueueHostCommand(run, client);
}

export async function executeTopologyCommands(
  commands: TopologyHostCommand[],
  options: ExecuteOptions = {},
  client: TopologySessionClient
): Promise<TopologyHostResponseMessage | null> {
  if (useTopoViewerStore.getState().isProcessing) {
    throw new Error("TopoViewer is processing; edits are temporarily disabled.");
  }
  const run = async () => {
    const applySnapshot = options.applySnapshot ?? true;
    let lastResponse: TopologyHostResponseMessage | null = null;

    for (const command of commands) {
      const response = await client.dispatchCommand(command);
      lastResponse = await handleHostResponse(response, false, client);

      if (response.type === HOST_REJECT) {
        if (applySnapshot) {
          applySnapshotToStores(response.snapshot, {}, client);
        }
        return response;
      }
    }

    if (applySnapshot) {
      if (lastResponse?.type === HOST_ACK && lastResponse.snapshot) {
        applySnapshotToStores(lastResponse.snapshot, {}, client);
      } else {
        const snapshot = await client.requestSnapshot({});
        applySnapshotToStores(snapshot, {}, client);
      }
    }

    return lastResponse;
  };
  return enqueueHostCommand(run, client);
}

export async function refreshTopologySnapshot(
  options: { externalChange?: boolean } = {},
  client: TopologySessionClient
): Promise<TopologySnapshot> {
  const snapshot = await client.requestSnapshot(options);
  applySnapshotToStores(snapshot, {}, client);
  notifyDevHostUpdate();
  return snapshot;
}
