import type { CaptureDelivery, LabHostInfo, LabHostSupport } from "@containerlab/clab-ui/host";

export interface StreamCaptureEnvironment {
  /** The app server opens Wireshark on this machine (the desktop app). */
  localWireshark: boolean;
}

/**
 * Where a capture can go on this lab host, the default first: Wireshark on
 * this machine in the desktop app, else Wireshark in a window when the lab
 * host runs Wireshark VNC; a download always.
 */
export function streamCaptureDeliveries(
  support: Pick<LabHostSupport, "wiresharkVnc">,
  environment: StreamCaptureEnvironment
): CaptureDelivery[] {
  const deliveries: CaptureDelivery[] = [];
  if (environment.localWireshark) deliveries.push("local-wireshark");
  if (support.wiresharkVnc) deliveries.push("wireshark-vnc");
  deliveries.push("download");
  return deliveries;
}

/**
 * Ways the lab host could offer but cannot now, with why: Wireshark VNC of a
 * cluster used from this machine without Docker here. The dialog shows them disabled.
 */
export function unavailableStreamCaptureDeliveries(
  info: Pick<LabHostInfo, "profile" | "support">
): Partial<Record<CaptureDelivery, string>> {
  const reason = info.support.wiresharkVnc ? undefined : info.profile.wiresharkVncUnavailable;
  return reason ? { "wireshark-vnc": reason } : {};
}
