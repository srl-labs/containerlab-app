import type * as graph from "../../src/commands/graph";

type LifecycleHandlers = ReturnType<typeof graph.createTopoViewerLifecycleHandlers>;

export const createdHandlers: {
  commandType: graph.LifecycleCommandType;
  options?: Parameters<typeof graph.createTopoViewerLifecycleHandlers>[1];
  handlers: LifecycleHandlers;
}[] = [];

export const createTopoViewerLifecycleHandlers: typeof graph.createTopoViewerLifecycleHandlers = (
  commandType,
  options
) => {
  const handlers: LifecycleHandlers = {
    onSuccess: async () => {},
    onFailure: async () => {},
    onOutputLine: () => {}
  };
  createdHandlers.push({ commandType, options, handlers });
  return handlers;
};

export const notifyCurrentTopoViewerOfCommandFailure: typeof graph.notifyCurrentTopoViewerOfCommandFailure =
  async () => {};
