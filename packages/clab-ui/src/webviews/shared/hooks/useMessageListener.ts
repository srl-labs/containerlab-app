import { useEffect, useRef } from "react";

import { useClabUiHost } from "../../../host";

interface WebviewMessage {
  command?: string;
  type?: string;
}

export function useMessageListener<T extends WebviewMessage>(
  handler: (message: T) => void
): void {
  const host = useClabUiHost();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    return host.subscribe((event) => {
      handlerRef.current(event.data as T);
    });
  }, [host]);
}
