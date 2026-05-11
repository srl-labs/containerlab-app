export type EndpointUiAction =
  | { action: "reconnect"; endpointId: string }
  | { action: "remove"; endpointId: string };

const ENDPOINT_UI_ACTION_EVENT = "clab-standalone:endpoint-ui-action";

export function dispatchEndpointUiAction(action: EndpointUiAction): void {
  window.dispatchEvent(
    new CustomEvent<EndpointUiAction>(ENDPOINT_UI_ACTION_EVENT, {
      detail: action
    })
  );
}

export function subscribeEndpointUiAction(
  listener: (action: EndpointUiAction) => void
): () => void {
  const handleEvent = (event: Event) => {
    const detail = (event as CustomEvent<EndpointUiAction>).detail;
    if (detail?.endpointId && (detail.action === "reconnect" || detail.action === "remove")) {
      listener(detail);
    }
  };

  window.addEventListener(ENDPOINT_UI_ACTION_EVENT, handleEvent);
  return () => {
    window.removeEventListener(ENDPOINT_UI_ACTION_EVENT, handleEvent);
  };
}
