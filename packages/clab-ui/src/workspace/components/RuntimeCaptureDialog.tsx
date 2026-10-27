// Capture dialog for an explorer node: lists the container's live interfaces,
// or on a lab host with capture streams (c9s) the lab-link interfaces of its nodes.
import React from "react";
import Box from "@mui/material/Box";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";

import { CaptureInterfacesDialog } from "../../components/panels/capture/CaptureInterfacesDialog";
import {
  buildLinkCaptureOptions,
  buildRuntimeCaptureOptions,
  type CaptureRequestGroup
} from "../../components/panels/capture/captureInterfaceOptions";
import {
  CAPTURE_DELIVERY_LABELS,
  CAPTURE_DURATIONS,
  type CaptureDelivery,
  type LabCaptureInterface
} from "../../host/captureStream";
import {
  initialCaptureSelection,
  rememberCaptureSelection
} from "../../components/panels/capture/captureSelectionMemory";
import { useWorkspaceLabs } from "../WorkspaceHost";
import { findRuntimeContainer } from "../state/runtimeContainerLookup";
import {
  useRuntimeUiStore,
  type RuntimeCaptureRequest,
  type RuntimeStreamCaptureRequest
} from "../state/runtimeUiStore";

const UNTIL_STOPPED = "";

/** Where the capture goes and for how long; a download always has an end. */
const StreamCaptureControls: React.FC<{
  deliveries: readonly CaptureDelivery[];
  delivery: CaptureDelivery;
  duration: string;
  onDeliveryChange: (delivery: CaptureDelivery) => void;
  onDurationChange: (duration: string) => void;
}> = ({ deliveries, delivery, duration, onDeliveryChange, onDurationChange }) => (
  <Box sx={{ display: "flex", gap: 1.5 }}>
    <TextField
      select
      size="small"
      label="Open in"
      value={delivery}
      onChange={(event) => onDeliveryChange(event.target.value as CaptureDelivery)}
      sx={{ flex: 3 }}
      slotProps={{ htmlInput: { "data-testid": "capture-delivery" } }}
    >
      {deliveries.map((entry) => (
        <MenuItem key={entry} value={entry} data-testid={`capture-delivery-${entry}`}>
          {CAPTURE_DELIVERY_LABELS[entry]}
        </MenuItem>
      ))}
    </TextField>
    <TextField
      select
      size="small"
      label="Stop after"
      // Wireshark VNC captures until its window closes.
      disabled={delivery === "wireshark-vnc"}
      value={delivery === "wireshark-vnc" ? UNTIL_STOPPED : duration}
      onChange={(event) => onDurationChange(event.target.value)}
      sx={{ flex: 2 }}
      slotProps={{ htmlInput: { "data-testid": "capture-duration" } }}
    >
      {delivery === "download" ? null : <MenuItem value={UNTIL_STOPPED}>Until stopped</MenuItem>}
      {CAPTURE_DURATIONS.map((entry) => (
        <MenuItem key={entry.value} value={entry.value} data-testid={`capture-duration-${entry.value}`}>
          {entry.label}
        </MenuItem>
      ))}
    </TextField>
  </Box>
);

const DOWNLOAD_DEFAULT_DURATION = "30s";

const StreamCaptureDialogContent: React.FC<{ request: RuntimeCaptureRequest; stream: RuntimeStreamCaptureRequest }> = ({
  request,
  stream
}) => {
  const closeCapture = useRuntimeUiStore((state) => state.closeCapture);
  const [interfaces, setInterfaces] = React.useState<LabCaptureInterface[] | undefined>(undefined);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [delivery, setDelivery] = React.useState<CaptureDelivery>(stream.deliveries[0] ?? "download");
  const [duration, setDuration] = React.useState(delivery === "download" ? DOWNLOAD_DEFAULT_DURATION : UNTIL_STOPPED);
  const memoryKey = `stream:${stream.nodes.join(",")}`;

  React.useEffect(() => {
    let active = true;
    stream.loadInterfaces().then(
      (loaded) => {
        if (active) setInterfaces(loaded);
      },
      (reason: unknown) => {
        if (!active) return;
        setInterfaces([]);
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    );
    return () => {
      active = false;
    };
  }, [stream]);

  const options = React.useMemo(
    () => buildLinkCaptureOptions(interfaces ?? [], stream.nodes),
    [interfaces, stream.nodes]
  );
  const initialSelection = React.useMemo(() => {
    const available = new Set(options.map((option) => option.name));
    const requested = (stream.initialSelection ?? []).filter((name) => available.has(name));
    return requested.length > 0 ? requested : initialCaptureSelection(memoryKey, options);
  }, [memoryKey, options, stream.initialSelection]);

  const changeDelivery = React.useCallback((next: CaptureDelivery) => {
    setDelivery(next);
    if (next === "download") setDuration((current) => current || DOWNLOAD_DEFAULT_DURATION);
  }, []);

  const handleCapture = React.useCallback(
    (groups: CaptureRequestGroup[]) => {
      const names = groups.flatMap((group) => group.interfaceNames);
      rememberCaptureSelection(memoryKey, names);
      const byName = new Map(options.map((option) => [option.name, option]));
      const picked = names.flatMap((name) => {
        const option = byName.get(name);
        return option ? [option] : [];
      });
      closeCapture();
      stream.onCapture({
        targets: picked.map((option) => ({ node: option.containerName, interface: option.label })),
        delivery,
        ...(duration !== UNTIL_STOPPED && delivery !== "wireshark-vnc" ? { duration } : {}),
        label: picked.map((option) => `${option.containerName}:${option.label}`).join(", ")
      });
    },
    [closeCapture, delivery, duration, memoryKey, options, stream]
  );

  return (
    <CaptureInterfacesDialog
      // Mounted again once the interfaces arrived, so the selection starts from them.
      key={interfaces === undefined ? "loading" : "loaded"}
      open
      nodeLabel={stream.nodes.join(", ") || request.nodeName}
      options={options}
      initialSelection={initialSelection}
      linksKnown
      oneStream
      loading={interfaces === undefined}
      submitLabel={delivery === "download" ? "Capture and download" : undefined}
      footerExtra={
        <>
          {error !== undefined ? (
            <Box sx={{ fontSize: 12, color: "error.main" }} data-testid="capture-interfaces-error">
              {error}
            </Box>
          ) : null}
          <StreamCaptureControls
            deliveries={stream.deliveries}
            delivery={delivery}
            duration={duration}
            onDeliveryChange={changeDelivery}
            onDurationChange={setDuration}
          />
        </>
      }
      onClose={closeCapture}
      onCapture={handleCapture}
    />
  );
};

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
  const key = `${request.endpointId ?? ""}:${request.nodeName}`;
  if (request.stream) return <StreamCaptureDialogContent key={key} request={request} stream={request.stream} />;
  return <RuntimeCaptureDialogContent key={key} request={request} />;
}
