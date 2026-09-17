import { useEffect, useRef } from "react";

import { useClabUiHost } from "../../../host";

export function useReadySignal(): void {
  const host = useClabUiHost();
  const sentRef = useRef(false);

  useEffect(() => {
    if (sentRef.current) {
      return;
    }

    sentRef.current = true;
    host.explorer.connect();
  }, [host]);
}
