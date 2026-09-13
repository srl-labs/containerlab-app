import type {
  ClabUiHost,
  TopologySessionContext,
  TopologyUiRequestOptions
} from "../host/contracts";
import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "../core/types/messages";

export type { TopologySessionContext };

export interface TopologySessionClient {
  dispatchCommand(command: TopologyHostCommand): Promise<TopologyHostResponseMessage>;
  getContext(): TopologySessionContext;
  getRevision(): number;
  requestSnapshot(options?: TopologyUiRequestOptions): Promise<TopologySnapshot>;
  setContext(update: Partial<TopologySessionContext>): void;
  setRevision(nextRevision: number): void;
}

export interface CreateTopologySessionClientOptions {
  host: Pick<ClabUiHost, "topology">;
  initialContext?: TopologySessionContext;
  initialRevision?: number;
}

export function createTopologySessionClient(
  options: CreateTopologySessionClientOptions
): TopologySessionClient {
  let context: TopologySessionContext = options.initialContext ?? {};
  let revision = options.initialRevision ?? 1;

  return {
    async dispatchCommand(command: TopologyHostCommand): Promise<TopologyHostResponseMessage> {
      return options.host.topology.dispatchCommand(context, revision, command);
    },

    getContext(): TopologySessionContext {
      return context;
    },

    getRevision(): number {
      return revision;
    },

    async requestSnapshot(
      requestOptions: TopologyUiRequestOptions = {}
    ): Promise<TopologySnapshot> {
      return options.host.topology.requestSnapshot(context, requestOptions);
    },

    setContext(update: Partial<TopologySessionContext>): void {
      context = { ...context, ...update };
    },

    setRevision(nextRevision: number): void {
      revision = nextRevision;
    }
  };
}
