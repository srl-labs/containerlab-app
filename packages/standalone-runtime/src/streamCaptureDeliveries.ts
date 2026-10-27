import type { CaptureDelivery, LabHostSupport } from "@containerlab/clab-ui/host";

export interface StreamCaptureEnvironment {
  /** The app server opens Wireshark on this machine (the desktop app). */
  localWireshark: boolean;
  /** The desktop app, which blocks `packetflix:` links. */
  desktop: boolean;
  /** The user prefers `packetflix:` links (the "Edgeshark" capture setting). */
  preferLinks?: boolean;
}

/**
 * Where a capture can go on this lab host, the default first: Wireshark on
 * this machine in the desktop app, else Wireshark in a window when the lab
 * host runs Wireshark VNC, else a `packetflix:` link; a download always.
 */
export function streamCaptureDeliveries(
  support: Pick<LabHostSupport, "wiresharkVnc" | "captureTickets">,
  environment: StreamCaptureEnvironment
): CaptureDelivery[] {
  const deliveries: CaptureDelivery[] = [];
  if (environment.localWireshark) deliveries.push("local-wireshark");
  if (support.wiresharkVnc) deliveries.push("wireshark-vnc");
  // The desktop app blocks packetflix: links.
  if (support.captureTickets && !environment.desktop) {
    if (environment.preferLinks === true && !environment.localWireshark) deliveries.unshift("packetflix");
    else deliveries.push("packetflix");
  }
  deliveries.push("download");
  return deliveries;
}
