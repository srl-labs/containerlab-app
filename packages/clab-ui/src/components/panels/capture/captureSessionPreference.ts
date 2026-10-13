// Whether a multi-interface capture opens one session per interface.
// Kept per viewer; storage may be unavailable, so reads fall back to "combined".
const SEPARATE_SESSIONS_KEY = "clab.capture.separateSessions";

export function readSeparateCaptureSessions(): boolean {
  try {
    return localStorage.getItem(SEPARATE_SESSIONS_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeSeparateCaptureSessions(separate: boolean): void {
  try {
    localStorage.setItem(SEPARATE_SESSIONS_KEY, separate ? "true" : "false");
  } catch {
    /* Storage may be unavailable. */
  }
}
