// Capture dialog for an explorer node: lists the container's live interfaces.
import React from "react";

import { CaptureInterfacesDialog } from "../../components/panels/capture/CaptureInterfacesDialog";
import {
  buildRuntimeCaptureOptions,
  type CaptureRequestGroup
} from "../../components/panels/capture/captureInterfaceOptions";
import {
  initialCaptureSelection,
  rememberCaptureSelection
} from "../../components/panels/capture/captureSelectionMemory";
import { useWorkspaceLabs } from "../WorkspaceHost";
import { findRuntimeContainer } from "../state/runtimeContainerLookup";
import { useRuntimeUiStore, type RuntimeCaptureRequest } from "../state/runtimeUiStore";

const RuntimeCaptureDialogContent: React.FC<{ request: RuntimeCaptureRequest }> = ({ request }) => {
  const labs = useWorkspaceLabs();
  const closeCapture = useRuntimeUiStore((state) => state.closeCapture);
  const container = React.useMemo(
    () =>
      findRuntimeContainer(labs, {
        endpointId: request.endpointId,
        topologyRef: request.topologyRef,
        nodeName: request.nodeName
      }),
    [labs, request]
  );
  const containerName = container?.name ?? request.nodeName;
  const options = React.useMemo(
    () =>
      buildRuntimeCaptureOptions(
        containerName,
        [...(container?.interfaces.values() ?? [])],
        container?.kind
      ),
    [container, containerName]
  );
  const [initialSelection] = React.useState(() =>
    initialCaptureSelection(containerName, options, false)
  );

  const handleCapture = React.useCallback(
    (groups: CaptureRequestGroup[]) => {
      rememberCaptureSelection(
        containerName,
        groups.flatMap((group) => group.interfaceNames)
      );
      closeCapture();
      const labels = new Map(options.map((option) => [option.name, option.label]));
      request.onCapture(
        groups.map((group) => ({
          interfaceNames: group.interfaceNames,
          nodeNamespace: group.nodeNamespace,
          label: group.interfaceNames.map((name) => labels.get(name) ?? name).join(", ")
        }))
      );
    },
    [closeCapture, containerName, options, request]
  );

  return (
    <CaptureInterfacesDialog
      open
      nodeLabel={container !== undefined && container.nodeName.length > 0 ? container.nodeName : request.nodeName}
      containerName={containerName}
      options={options}
      initialSelection={initialSelection}
      linksKnown={false}
      onClose={closeCapture}
      onCapture={handleCapture}
    />
  );
};

export function RuntimeCaptureDialog() {
  const request = useRuntimeUiStore((state) => state.captureRequest);
  if (!request) return null;
  return <RuntimeCaptureDialogContent key={`${request.endpointId ?? ""}:${request.nodeName}`} request={request} />;
}
