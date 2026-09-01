import { useEffect, useRef } from "react";

import { useClabUiHost } from "../../../host";
import type { ExplorerIncomingMessage } from "../explorer/types";

export function useMessageListener<T extends ExplorerIncomingMessage>(
  handler: (message: T) => void
): void {
  const host = useClabUiHost();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    return host.explorer.subscribe((message) => {
      handlerRef.current(message as T);
    });
  }, [host]);
}
