/**
 * Opens Wireshark VNC capture sessions: one window per click, however many
 * sessions the click asked for. The page shows one tab per session.
 *
 * Browsers allow one pop-up per click, and only shortly after it, so the
 * window opens before the sessions exist and loads them once they do. The
 * desktop app opens its own window for every request, so it gets the final
 * page directly.
 */
import type { CaptureTarget, CaptureWiresharkVncSession } from "@srl-labs/containerlab-lab-backend";

/** One capture the user asked for; the API may split it into several sessions. */
export interface WiresharkCaptureRequest {
  targets: CaptureTarget[];
  /** Tab name, e.g. the interfaces as the user knows them (1/1/c1/1). */
  label?: string;
}

/** A created session as the Wireshark page shows it. */
export interface WiresharkPageSession {
  sessionId: string;
  label?: string;
  showVolumeTip?: boolean;
}

export interface WiresharkPageOptions {
  theme: "light" | "dark";
  endpointId?: string;
}

/** What wireshark.html was asked to show. */
export interface WiresharkPageQuery {
  sessions: WiresharkPageSession[];
  endpointId?: string;
  theme?: string;
  showVolumeTip: boolean;
  /** Shown inside the multi-session page, which draws the window chrome. */
  embedded: boolean;
  /** Opened before its sessions exist: show the loading state. */
  pending: boolean;
}

export const POPUP_BLOCKED_MESSAGE =
  "The browser blocked the Wireshark window. Allow pop-ups for this site and try again.";
const NO_SESSIONS_MESSAGE = "No Wireshark sessions were created.";

function nonEmpty(value: string | null | undefined): string | undefined {
  const text = value?.trim();
  return text !== undefined && text.length > 0 ? text : undefined;
}

/** Query for the final page. One session keeps the single-session URL. */
export function buildWiresharkPageSearch(
  sessions: readonly WiresharkPageSession[],
  options: WiresharkPageOptions
): string {
  const params = new URLSearchParams();
  for (const session of sessions) {
    params.append("sessionId", session.sessionId);
  }
  // Labels pair with sessions by position, so every session gets one.
  if (sessions.some((session) => nonEmpty(session.label) !== undefined)) {
    for (const session of sessions) {
      params.append("label", session.label?.trim() ?? "");
    }
  }
  params.set("theme", options.theme);
  if (options.endpointId !== undefined) {
    params.set("endpointId", options.endpointId);
  }
  if (sessions.some((session) => session.showVolumeTip === true)) {
    params.set("showVolumeTip", "1");
  }
  return params.toString();
}

/** Query for the window opened while the sessions are still being created. */
export function buildPendingWiresharkPageSearch(theme: "light" | "dark"): string {
  return new URLSearchParams({ pending: "1", theme }).toString();
}

/** Query for one session inside the multi-session page. */
export function buildEmbeddedWiresharkPageSearch(
  sessionId: string,
  query: Pick<WiresharkPageQuery, "endpointId" | "showVolumeTip" | "theme">
): string {
  const params = new URLSearchParams({ sessionId, embedded: "1" });
  if (query.theme !== undefined) {
    params.set("theme", query.theme);
  }
  if (query.endpointId !== undefined) {
    params.set("endpointId", query.endpointId);
  }
  params.set("showVolumeTip", query.showVolumeTip ? "1" : "0");
  return params.toString();
}

export function parseWiresharkPageSearch(search: string): WiresharkPageQuery {
  const params = new URLSearchParams(search);
  const labels = params.getAll("label");
  const sessions: WiresharkPageSession[] = [];
  params.getAll("sessionId").forEach((rawId, index) => {
    const sessionId = nonEmpty(rawId);
    if (sessionId === undefined) {
      return;
    }
    const label = nonEmpty(labels[index]);
    sessions.push(label !== undefined ? { sessionId, label } : { sessionId });
  });
  const endpointId = nonEmpty(params.get("endpointId"));
  const theme = nonEmpty(params.get("theme"));
  return {
    sessions,
    ...(endpointId !== undefined ? { endpointId } : {}),
    ...(theme !== undefined ? { theme } : {}),
    showVolumeTip: params.get("showVolumeTip") !== "0",
    embedded: params.get("embedded") === "1",
    pending: params.get("pending") === "1"
  };
}

/** Tab names for every session, in order; untitled ones are numbered. */
export function sessionTabLabels(sessions: readonly WiresharkPageSession[]): string[] {
  return sessions.map((session, index) => nonEmpty(session.label) ?? `Capture ${index + 1}`);
}

export function wiresharkPageTitle(sessions: readonly WiresharkPageSession[]): string {
  const labels = sessions
    .map((session) => nonEmpty(session.label))
    .filter((label): label is string => label !== undefined);
  return labels.length > 0 ? `Wireshark · ${labels.join(", ")}` : "Wireshark Capture";
}

function shortNodeName(session: CaptureWiresharkVncSession): string {
  const prefix = `clab-${session.labName}-`;
  return session.labName && session.containerName.startsWith(prefix)
    ? session.containerName.slice(prefix.length)
    : session.containerName;
}

/**
 * Created sessions in request order, each with a tab name. A request that
 * became one session keeps its label; one the API split names each part by
 * its interfaces. Sessions from several nodes also name their node.
 */
export function labelCreatedSessions(
  requests: readonly WiresharkCaptureRequest[],
  created: readonly (readonly CaptureWiresharkVncSession[])[]
): WiresharkPageSession[] {
  const all = created.flat();
  const severalNodes = new Set(all.map((session) => session.containerName)).size > 1;
  return requests.flatMap((request, index) => {
    const sessions = created[index] ?? [];
    return sessions.map((session) => {
      const interfaces = session.interfaceNames.join(", ");
      const name =
        (sessions.length === 1 ? nonEmpty(request.label) : undefined) ??
        nonEmpty(interfaces) ??
        nonEmpty(request.label);
      const node = shortNodeName(session);
      // Name the node when the window mixes nodes, unless the label already does.
      const label =
        severalNodes && name !== undefined && !name.startsWith(node) ? `${node}: ${name}` : name;
      return {
        sessionId: session.sessionId,
        ...(label !== undefined ? { label } : {}),
        ...(session.showVolumeTip ? { showVolumeTip: true } : {})
      };
    });
  });
}

/** Collects calls made in the same task, e.g. one click, and hands them over together. */
export function createCaptureBatcher<T>(
  flush: (items: T[]) => void,
  schedule: (callback: () => void) => void = queueMicrotask
): (item: T) => void {
  let queued: T[] | undefined;
  return (item) => {
    if (queued) {
      queued.push(item);
      return;
    }
    queued = [item];
    schedule(() => {
      const items = queued ?? [];
      queued = undefined;
      flush(items);
    });
  };
}

export interface WiresharkLaunchHost {
  /** The desktop app opens its own window and `openWindow` returns null by design. */
  desktop: boolean;
  /** URL of wireshark.html with the given query. */
  pageUrl: (search: string) => string;
  openWindow: (url: string) => Window | null;
  createSessions: (request: WiresharkCaptureRequest) => Promise<CaptureWiresharkVncSession[]>;
  closeSession: (sessionId: string) => void;
  notify: (message: string, severity: "error" | "warning") => void;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

/**
 * Creates one session set per request, in parallel, and shows them all in one
 * window. Must be called synchronously from the click. Resolves to the number
 * of sessions shown.
 */
export async function launchWiresharkCapture(
  requests: readonly WiresharkCaptureRequest[],
  options: WiresharkPageOptions,
  host: WiresharkLaunchHost
): Promise<number> {
  if (requests.length === 0) {
    return 0;
  }

  // Before any await: the click allows one window, and only for a few seconds.
  const pending = host.desktop
    ? null
    : host.openWindow(host.pageUrl(buildPendingWiresharkPageSearch(options.theme)));

  const results = await Promise.allSettled(requests.map((request) => host.createSessions(request)));
  const failure = results.find((result) => result.status === "rejected");
  const sessions = labelCreatedSessions(
    requests,
    results.map((result) => (result.status === "fulfilled" ? result.value : []))
  );
  if (failure) {
    host.notify(errorMessage(failure.reason), "error");
  }
  if (sessions.length === 0) {
    pending?.close();
    if (!failure) {
      host.notify(NO_SESSIONS_MESSAGE, "warning");
    }
    return 0;
  }

  const url = host.pageUrl(buildWiresharkPageSearch(sessions, options));
  const closeAll = () => {
    for (const session of sessions) {
      host.closeSession(session.sessionId);
    }
  };

  if (pending) {
    if (pending.closed) {
      // Closed while waiting: the user no longer wants these sessions.
      closeAll();
      return 0;
    }
    pending.location.replace(url);
    return sessions.length;
  }

  const opened = host.openWindow(url);
  if (!opened && !host.desktop) {
    closeAll();
    host.notify(POPUP_BLOCKED_MESSAGE, "error");
    return 0;
  }
  return sessions.length;
}
