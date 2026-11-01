/**
 * The default capture method a user picks, and where a capture opens on a
 * lab host with it. One model for VS Code (`containerlab.capture.preferredAction`)
 * and the web and desktop apps (their capture settings), so a pick means the
 * same everywhere: what the user picked opens when the lab host has it; else
 * the capture opens the automatic way and says why.
 */

/**
 * `auto` picks per lab host: Wireshark on this computer when the host streams
 * captures into it and Wireshark is there, else Wireshark VNC, else Edgeshark
 * or a download.
 */
export type CaptureMethod = "auto" | "local-wireshark" | "wireshark-vnc" | "edgeshark";

/** Where one capture opens. `download` saves a `.pcapng` (lab hosts with capture streams). */
export type CaptureRoute = "local-wireshark" | "wireshark-vnc" | "edgeshark" | "download";

export const CAPTURE_METHODS: readonly CaptureMethod[] = ["auto", "local-wireshark", "wireshark-vnc", "edgeshark"];

/** How settings name the methods; also the values of VS Code's `capture.preferredAction`. */
export const CAPTURE_METHOD_LABELS: Record<CaptureMethod, string> = {
  auto: "Automatic",
  "local-wireshark": "Wireshark on this computer",
  "wireshark-vnc": "Wireshark VNC",
  edgeshark: "Edgeshark"
};

const ROUTE_LABELS: Record<CaptureRoute, string> = {
  "local-wireshark": "Wireshark on this computer",
  "wireshark-vnc": "Wireshark VNC",
  edgeshark: "Edgeshark",
  download: "a .pcapng file"
};

/** Why a Kubernetes (c9s) lab host has no Edgeshark. */
export const EDGESHARK_ON_KUBERNETES =
  "Edgeshark is not supported on Kubernetes (c9s): clabernetes captures lab links as one stream instead";

/**
 * A stored or configured method: an id (`wireshark-vnc`) or a label
 * (`Wireshark VNC`). Anything else, and nothing, is `auto`.
 */
export function parseCaptureMethod(value: unknown): CaptureMethod {
  if (typeof value !== "string") return "auto";
  const text = value.trim();
  for (const method of CAPTURE_METHODS) {
    if (text === method || text === CAPTURE_METHOD_LABELS[method]) return method;
  }
  return "auto";
}

/** What a lab host and the app offer for captures. */
export interface CaptureMethodHost {
  /** The lab host captures lab links as one stream (c9s): no Edgeshark, but downloads. */
  stream: boolean;
  /** Stream hosts: the app can open Wireshark on this computer and found it. */
  localWireshark: boolean;
  /** Why not, e.g. "Wireshark was not found on this computer". */
  localWiresharkUnavailable?: string;
  wiresharkVnc: boolean;
  /** Why the lab host has no Wireshark VNC, e.g. no Docker on this computer. */
  wiresharkVncUnavailable?: string;
  /** Docker and Podman hosts: Edgeshark's `packetflix:` links. */
  edgeshark: boolean;
}

export interface CaptureRoutePlan {
  /** Where the capture can open, the one to use first. Empty when nowhere. */
  routes: CaptureRoute[];
  /** The picked method is not available on this host: why, and what opens instead. */
  notice?: string;
}

function routeAvailable(route: CaptureRoute, host: CaptureMethodHost): boolean {
  switch (route) {
    case "local-wireshark":
      return host.stream && host.localWireshark;
    case "wireshark-vnc":
      return host.wiresharkVnc;
    case "edgeshark":
      return !host.stream && host.edgeshark;
    case "download":
      return host.stream;
  }
}

/**
 * The route a method asks for. On Docker and Podman Wireshark on this
 * computer opens through Edgeshark: its `packetflix:` link starts it.
 */
function methodRoute(method: Exclude<CaptureMethod, "auto">, host: CaptureMethodHost): CaptureRoute {
  if (method === "local-wireshark" && !host.stream) return "edgeshark";
  return method;
}

function unavailableReason(method: Exclude<CaptureMethod, "auto">, host: CaptureMethodHost): string {
  switch (method) {
    case "local-wireshark":
      if (!host.stream) return "it opens through Edgeshark on this lab host, which has none";
      return host.localWiresharkUnavailable ?? "this app cannot open Wireshark on this computer";
    case "wireshark-vnc":
      return host.wiresharkVncUnavailable ?? "this lab host has no Wireshark VNC";
    case "edgeshark":
      return host.stream ? EDGESHARK_ON_KUBERNETES : "this lab host has no Edgeshark";
  }
}

/** Where captures open on this lab host with `method` picked, first route first. */
export function captureRoutePlan(method: CaptureMethod, host: CaptureMethodHost): CaptureRoutePlan {
  const automatic = (
    host.stream
      ? (["local-wireshark", "wireshark-vnc", "download"] as const)
      : (["wireshark-vnc", "edgeshark"] as const)
  ).filter((route) => routeAvailable(route, host));
  if (method === "auto") return { routes: automatic };
  const wanted = methodRoute(method, host);
  if (routeAvailable(wanted, host)) {
    return { routes: [wanted, ...automatic.filter((route) => route !== wanted)] };
  }
  const instead = automatic.at(0);
  const reason = unavailableReason(method, host);
  return {
    routes: automatic,
    notice: `${CAPTURE_METHOD_LABELS[method]}, your default capture method, is not available here: ${reason}.${
      instead ? ` Using ${ROUTE_LABELS[instead]} instead.` : ""
    }`
  };
}
