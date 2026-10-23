import type { AlertColor } from "@mui/material/Alert";

import type { EndpointStatus } from "../types";

export function endpointStatusLabel(status: EndpointStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "session_expired":
      return "Sign-In Expired";
    case "offline":
      return "Unreachable";
    case "saved":
      return "Signed Out";
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
      return "Signed in.";
    case "session_expired":
      return "Your sign-in expired. Sign in again to see its labs.";
    case "offline":
      return "The lab host does not answer. Check that clab-api-server runs there and the URL is right.";
    case "saved":
      return "Signed out. Sign in to see its labs.";
    default:
      return "";
  }
}

export function endpointNeedsReconnect(status: EndpointStatus): boolean {
  return status === "saved" || status === "session_expired" || status === "offline";
}
