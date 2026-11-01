import React from "react";

import { useClabUiHost } from "../../../host";
import type { LabNodeLocation } from "../../../host/kubernetes";
import { useLabHostStore } from "../../../stores/labHostStore";

/**
 * Where a node of the open lab runs on its c9s host, from `containerlab
 * inspect`; undefined on other hosts and until the host answered.
 */
export function useNodeLocation(nodeName: string | undefined, refreshKey?: unknown): LabNodeLocation | undefined {
  const operations = useClabUiHost().topoViewer.labOperations;
  const c9s = useLabHostStore((state) => state.info?.profile.runtime === "c9s");
  const [location, setLocation] = React.useState<LabNodeLocation | undefined>(undefined);
  React.useEffect(() => {
    if (!c9s || !operations || !nodeName) {
      setLocation(undefined);
      return;
    }
    let cancelled = false;
    operations.nodeLocations().then(
      (locations) => {
        if (!cancelled) setLocation(locations.find((entry) => entry.node === nodeName));
      },
      () => {
        if (!cancelled) setLocation(undefined);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [c9s, operations, nodeName, refreshKey]);
  return location;
}
