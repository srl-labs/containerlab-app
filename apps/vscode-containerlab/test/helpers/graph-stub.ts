import type * as graph from "../../src/commands/graph";

type LifecycleHandlers = ReturnType<typeof graph.createTopoViewerLifecycleHandlers>;

export const createdHandlers: {
  commandType: graph.LifecycleCommandType;
  handlers: LifecycleHandlers;
}[] = [];

export const createTopoViewerLifecycleHandlers: typeof graph.createTopoViewerLifecycleHandlers = (
  commandType
) => {
  const handlers: LifecycleHandlers = {
    onSuccess: async () => {},
    onFailure: async () => {},
    onOutputLine: () => {}
  };
  createdHandlers.push({ commandType, handlers });
  return handlers;
};

export const notifyCurrentTopoViewerOfCommandFailure: typeof graph.notifyCurrentTopoViewerOfCommandFailure =
  async () => {};
