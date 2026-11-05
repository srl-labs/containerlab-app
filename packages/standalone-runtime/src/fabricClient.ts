/** The Fabric view's client in the web and desktop apps, and the window it opens in. */
import {
  FabricApiError,
  parseFclingEvents,
  type FabricClient,
  type FclingEngineStatus
} from "@containerlab/clab-ui/fabric/engine";

import { runtimeFetch } from "./backend";
import { publicAssetUrl } from "./publicAssetUrl";
import { standaloneServerUrl } from "./standaloneServerOrigin";

/** Opens a lab's Fabric view in its own window. Call it synchronously from the click. */
export function openFabricWindow(
  labName: string,
  endpointId: string | undefined,
  theme: "light" | "dark"
): void {
  const search = new URLSearchParams({ labName, theme });
  if (endpointId) search.set("endpointId", endpointId);
  window.open(`${publicAssetUrl("fabric.html")}?${search.toString()}`, "_blank");
}

async function readChunks(body: ReadableStream<Uint8Array>): Promise<AsyncGenerator<Uint8Array>> {
  const reader = body.getReader();
  return (async function* () {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  })();
}

async function responseError(response: Response): Promise<FabricApiError> {
  const text = await response.text().catch(() => "");
  let message = text || response.statusText;
  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body.error === "string") message = body.error;
  } catch {
    // Not JSON: the text says what there is.
  }
  return new FabricApiError(response.status, message);
}

export function createStandaloneFabricClient(labName: string, endpointId?: string): FabricClient {
  const endpointHeaders: Record<string, string> = endpointId ? { "x-endpoint-id": endpointId } : {};

  async function post<T>(path: string, body: object): Promise<T> {
    const response = await runtimeFetch(standaloneServerUrl(`/api/runtime/fcling/${path}`), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...endpointHeaders },
      body: JSON.stringify({ labName, ...(endpointId ? { endpointId } : {}), ...body })
    });
    if (!response.ok) throw await responseError(response);
    return (await response.json()) as T;
  }

  return {
    engineStatus: () => post<FclingEngineStatus>("engine/status", {}),
    startEngine: () => post<FclingEngineStatus>("engine/start", {}),
    stopEngine: async () => {
      await post<unknown>("engine/stop", {});
    },
    api: <T>(request: Parameters<FabricClient["api"]>[0]) => post<T>("api", { request }),
    openEvents(handlers, options) {
      const controller = new AbortController();
      const { signal } = controller;
      void (async () => {
        let failure: Error | undefined;
        try {
          const search = new URLSearchParams({ labName });
          if (options?.after !== undefined) search.set("after", String(options.after));
          const response = await runtimeFetch(
            `${standaloneServerUrl("/api/runtime/fcling/events")}?${search.toString()}`,
            { credentials: "include", headers: endpointHeaders, signal }
          );
          if (!response.ok || !response.body) throw await responseError(response);
          handlers.onOpen?.();
          for await (const event of parseFclingEvents(await readChunks(response.body))) {
            if (signal.aborted) return;
            handlers.onEvent(event);
          }
        } catch (error) {
          failure = error instanceof Error ? error : new Error(String(error));
        }
        if (!signal.aborted) handlers.onClose?.(failure);
      })();
      return () => controller.abort();
    }
  };
}
