import {
  captureRoutePlan,
  type CaptureDelivery,
  type CaptureMethod,
  type LabHostInfo,
  type LabHostSupport
} from "@containerlab/clab-ui/host";

export interface StreamCaptureEnvironment {
  /** The app server opens Wireshark on this machine (the desktop app). */
  localWireshark: boolean;
}

export interface StreamCaptureDeliveries {
  /** Where the capture can go, the one the dialog starts with first. */
  deliveries: CaptureDelivery[];
  /** The default capture method is not available here: why, and what the dialog starts with instead. */
  notice?: string;
}

/**
 * Where a capture can go on a lab host with capture streams (c9s), the
 * default first: the endpoint's default capture method when the host has it,
 * else Wireshark on this machine in the desktop app, else Wireshark in a
 * window when the lab host runs Wireshark VNC; a download always.
 */
export function streamCaptureDeliveries(
  info: { support: Pick<LabHostSupport, "wiresharkVnc">; profile?: Pick<LabHostInfo["profile"], "wiresharkVncUnavailable"> },
  environment: StreamCaptureEnvironment,
  preferred: CaptureMethod = "auto"
): StreamCaptureDeliveries {
  const vncUnavailable = info.profile?.wiresharkVncUnavailable;
  const plan = captureRoutePlan(preferred, {
    stream: true,
    localWireshark: environment.localWireshark,
    localWiresharkUnavailable: "the web app cannot start Wireshark on your computer",
    wiresharkVnc: info.support.wiresharkVnc,
    ...(vncUnavailable ? { wiresharkVncUnavailable: vncUnavailable } : {}),
    edgeshark: false
  });
  const deliveries = plan.routes.flatMap((route): CaptureDelivery[] =>
    route === "edgeshark" ? [] : [route]
  );
  return { deliveries, ...(plan.notice ? { notice: plan.notice } : {}) };
}

/**
 * How a capture opens on a Docker or Podman lab host: Edgeshark's packetflix
 * link (also for Wireshark on this computer, which the link starts) or
 * Wireshark VNC fed by Edgeshark. A host that has not answered yet is
 * assumed to have both; it refuses what it lacks.
 */
export function edgesharkCaptureRoute(
  preferred: CaptureMethod,
  support: Pick<LabHostSupport, "wiresharkVnc" | "edgeshark"> | undefined
): { route: "edgeshark" | "wireshark-vnc"; notice?: string } {
  const plan = captureRoutePlan(preferred, {
    stream: false,
    localWireshark: false,
    wiresharkVnc: support?.wiresharkVnc ?? true,
    edgeshark: support?.edgeshark ?? true
  });
  return {
    route: plan.routes[0] === "edgeshark" ? "edgeshark" : "wireshark-vnc",
    ...(plan.notice ? { notice: plan.notice } : {})
  };
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
