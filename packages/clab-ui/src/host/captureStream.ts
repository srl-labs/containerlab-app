/**
 * Capture streams of c9s lab hosts, as the UI sees them: the lab-link
 * interfaces a host captures on, and the ways a capture can be delivered.
 */
import { isRecord } from "../core/utilities/typeHelpers";

/** A lab-link interface with its link peer, as `containerlab capture --list` names it. */
export interface LabCaptureInterface {
  node: string;
  interface: string;
  /** The vendor name the topology used, e.g. `ethernet-1/1` for SR Linux `e1-1`. */
  alias?: string;
  peerNode: string;
  peerInterface: string;
}

/**
 * How a capture stream reaches the user: Wireshark in a browser window (VNC on
 * the lab host), Wireshark on this machine, or a `.pcapng` file.
 */
export type CaptureDelivery = "wireshark-vnc" | "local-wireshark" | "download";

export const CAPTURE_DELIVERY_LABELS: Record<CaptureDelivery, string> = {
  "wireshark-vnc": "Wireshark in a window",
  "local-wireshark": "Wireshark on this computer",
  download: "Download .pcapng"
};

/** Capture lengths offered, as Go durations; a download always needs one. */
export const CAPTURE_DURATIONS: readonly { value: string; label: string }[] = [
  { value: "5s", label: "5 seconds" },
  { value: "30s", label: "30 seconds" },
  { value: "1m", label: "1 minute" },
  { value: "5m", label: "5 minutes" },
  { value: "15m", label: "15 minutes" },
  { value: "1h", label: "1 hour" }
];

/** A lab-link interface in a stream capture picker, `<node>:<interface>`: unique across nodes. */
export function linkCaptureKey(node: string, iface: string): string {
  return `${node}:${iface}`;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Capture interfaces from a lab host (`peerNode`) or containerlab (`peer_node`). */
export function parseLabCaptureInterfaces(value: unknown): LabCaptureInterface[] {
  const list = isRecord(value) && Array.isArray(value.interfaces) ? value.interfaces : value;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry: unknown): LabCaptureInterface[] => {
    if (!isRecord(entry)) return [];
    const node = text(entry.node);
    const iface = text(entry.interface);
    if (node === undefined || node === "" || iface === undefined || iface === "") return [];
    const alias = text(entry.alias);
    return [
      {
        node,
        interface: iface,
        ...(alias !== undefined && alias !== "" ? { alias } : {}),
        peerNode: text(entry.peerNode) ?? text(entry.peer_node) ?? "",
        peerInterface: text(entry.peerInterface) ?? text(entry.peer_interface) ?? ""
      }
    ];
  });
}
