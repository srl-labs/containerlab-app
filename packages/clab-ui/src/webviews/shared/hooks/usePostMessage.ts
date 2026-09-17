import { useCallback } from "react";

import { useClabUiHost } from "../../../host";

export function usePostMessage<T = unknown>(): (message: T) => void {
  const host = useClabUiHost();

  return useCallback((message: T) => {
    host.postMessage(message);
  }, [host]);
}
