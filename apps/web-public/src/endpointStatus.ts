import type { AlertColor } from "@mui/material/Alert";

import type { EndpointStatus } from "./stores/endpointStore";

export function endpointStatusLabel(status: EndpointStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "session_expired":
      return "Session Expired";
    case "offline":
      return "Offline";
    case "saved":
      return "Saved";
    default:
      return "Unknown";
  }
}

export function endpointStatusSeverity(status: EndpointStatus): AlertColor {
  switch (status) {
    case "connected":
      return "success";
    case "session_expired":
      return "warning";
    case "offline":
      return "error";
    case "saved":
      return "info";
    default:
      return "info";
  }
}

export function endpointStatusHint(status: EndpointStatus): string {
  switch (status) {
    case "connected":
      return "Authenticated and reachable.";
    case "session_expired":
      return "Reconnect with your credentials to continue using this endpoint.";
    case "offline":
      return "The endpoint cannot be reached right now. Reconnect when it is available again.";
    case "saved":
      return "Saved locally. Reconnect to restore the browser session for this endpoint.";
    default:
      return "";
  }
}

export function endpointNeedsReconnect(status: EndpointStatus): boolean {
  return status === "saved" || status === "session_expired" || status === "offline";
}
