import React from "react";

import { useClabUiHost } from "../../host";
import { useLabHostStore } from "../../stores/labHostStore";
import { useDeploymentState } from "../../stores/topoViewerStore";

/** The lab host's runtime and support, asked again like the operation support. */
export function useLabHostLoader(): void {
  const { topoViewer } = useClabUiHost();
  const deploymentState = useDeploymentState();
  const setInfo = useLabHostStore((state) => state.setInfo);
  React.useEffect(() => {
    if (!topoViewer.labHost) {
      setInfo(undefined);
      return;
    }
    let cancelled = false;
    topoViewer.labHost().then(
      (info) => {
        if (!cancelled) setInfo(info);
      },
      () => {
        if (!cancelled) setInfo(undefined);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [topoViewer, deploymentState, setInfo]);
}

