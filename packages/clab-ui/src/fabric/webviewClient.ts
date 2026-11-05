/** The Fabric view's client in a webview: requests and events go through the extension host. */
import {
  FabricApiError,
  type FabricClient,
  type FabricEventHandlers,
  type FabricIncomingMessage,
  type FabricOutgoingMessage,
  type FabricWebviewRequest,
  type FclingEngineStatus
} from "./engine";

interface WebviewChannel {
  postMessage(message: unknown): void;
  subscribe(handler: (event: MessageEvent<unknown>) => void): () => void;
}

type PendingRequest = (message: Extract<FabricIncomingMessage, { type: "fabric:response" }>) => void;

export function createWebviewFabricClient(channel: WebviewChannel): FabricClient {
  const post = (message: FabricOutgoingMessage) => channel.postMessage(message);
  const requests = new Map<number, PendingRequest>();
  const streams = new Map<number, FabricEventHandlers>();
  let nextId = 1;

  channel.subscribe((messageEvent) => {
    const message = messageEvent.data as FabricIncomingMessage | undefined;
    switch (message?.type) {
      case "fabric:response": {
        requests.get(message.requestId)?.(message);
        requests.delete(message.requestId);
        break;
      }
      case "fabric:events-open":
        streams.get(message.streamId)?.onOpen?.();
        break;
      case "fabric:event":
        streams.get(message.streamId)?.onEvent(message.event);
        break;
      case "fabric:events-end": {
        const handlers = streams.get(message.streamId);
        streams.delete(message.streamId);
        handlers?.onClose?.(message.error === undefined ? undefined : new Error(message.error));
        break;
      }
      default:
        break;
    }
  });

  function request<T>(body: FabricWebviewRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      const requestId = nextId++;
      requests.set(requestId, (message) => {
        if (message.error === undefined) resolve(message.result as T);
        else reject(new FabricApiError(message.status ?? 500, message.error));
      });
      post({ type: "fabric:request", requestId, ...body });
    });
  }

  return {
    engineStatus: () => request<FclingEngineStatus>({ op: "engine-status" }),
    startEngine: () => request<FclingEngineStatus>({ op: "engine-start" }),
    stopEngine: () => request<void>({ op: "engine-stop" }),
    api: <T>(apiRequest: Parameters<FabricClient["api"]>[0]) =>
      request<T>({ op: "api", request: apiRequest }),
    openEvents(handlers, options) {
      const streamId = nextId++;
      streams.set(streamId, handlers);
      post({
        type: "fabric:events-start",
        streamId,
        ...(options?.after === undefined ? {} : { after: options.after })
      });
      return () => {
        if (streams.delete(streamId)) post({ type: "fabric:events-stop", streamId });
      };
    }
  };
}
