import type { AlertColor } from "@mui/material/Alert";

import type { EndpointConnectionIssue, EndpointEventStreamStatus, EndpointStatus } from "../types";

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

export function connectionApiLabel(api: EndpointConnectionIssue["api"]): string {
  switch (api) {
    case "reachable":
      return "Reachable";
    case "session_expired":
      return "Sign-in expired";
    default:
      return "Unreachable";
  }
}

/** The live-events state, with a countdown to the next attempt while one is scheduled. */
export function connectionEventsLabel(events: EndpointEventStreamStatus, now: number): string {
  switch (events.state) {
    case "connected":
      return "Connected";
    case "paused":
      return "Waiting for sign-in";
    case "reconnecting": {
      const seconds = events.retryAt === undefined ? 0 : Math.ceil((events.retryAt - now) / 1000);
      return seconds > 0 ? `Reconnecting in ${seconds} s` : "Retrying…";
    }
    default:
      return "Retrying…";
  }
}
