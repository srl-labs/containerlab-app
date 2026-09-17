/**
 * Initialize the webview state from the host snapshot.
 */

import { useEffect } from "react";

import { useTopologySessionClient } from "../../host";
import { applySnapshotToStores } from "../../services/topologyHostSync";
import { log } from "../../utils/logger";

export function useTopologyHostInitialization(): void {
  const sessionClient = useTopologySessionClient();

  useEffect(() => {
    let disposed = false;
    const isDisposed = () => disposed;
    void (async () => {
      try {
        const snapshot = await sessionClient.requestSnapshot({});
        if (isDisposed()) {
          return;
        }
        // Pass isInitialLoad: true to apply auto-layout if nodes have no preset positions
        applySnapshotToStores(snapshot, { isInitialLoad: true }, sessionClient);
      } catch (err) {
        log.error(
          `[TopologyHost] Failed to load snapshot: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    })();
    return () => {
      disposed = true;
    };
  }, [sessionClient]);
}
