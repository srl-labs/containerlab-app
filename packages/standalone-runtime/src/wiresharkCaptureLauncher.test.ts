import assert from "node:assert/strict";
import test from "node:test";

import type { CaptureWiresharkVncSession } from "@srl-labs/containerlab-app-contract";

import {
  POPUP_BLOCKED_MESSAGE,
  buildEmbeddedWiresharkPageSearch,
  buildPendingWiresharkPageSearch,
  buildWiresharkPageSearch,
  createCaptureBatcher,
  labelCreatedSessions,
  launchWiresharkCapture,
  parseWiresharkPageSearch,
  sessionTabLabels,
  wiresharkPageTitle,
  type WiresharkCaptureRequest,
  type WiresharkLaunchHost
} from "./wiresharkCaptureLauncher";

function session(
  sessionId: string,
  interfaceNames: string[],
  containerName = "clab-demo-srl1"
): CaptureWiresharkVncSession {
  return {
    sessionId,
    labName: "demo",
    containerName,
    interfaceNames,
    vncPath: `/vnc/${sessionId}/`,
    showVolumeTip: false,
    createdAt: "2026-10-13T10:00:00Z",
    expiresAt: "2026-10-13T11:00:00Z"
  };
}

function request(label: string | undefined, ...interfaceNames: string[]): WiresharkCaptureRequest {
  return {
    targets: interfaceNames.map((interfaceName) => ({ containerName: "clab-demo-srl1", interfaceName })),
    ...(label !== undefined ? { label } : {})
  };
}

test("a single session keeps the single-session page URL", () => {
  assert.equal(
    buildWiresharkPageSearch([{ sessionId: "s1", showVolumeTip: true }], {
      theme: "dark",
      endpointId: "ep-1"
    }),
    "sessionId=s1&theme=dark&endpointId=ep-1&showVolumeTip=1"
  );
  assert.equal(
    buildWiresharkPageSearch([{ sessionId: "s1" }], { theme: "light" }),
    "sessionId=s1&theme=light"
  );
});

test("several sessions round-trip with labels paired by position", () => {
  const search = buildWiresharkPageSearch(
    [
      { sessionId: "s1", label: "1/1/c1/1, 1/1/c2/1" },
      { sessionId: "s2" },
      { sessionId: "s3", label: "e1-3" }
    ],
    { theme: "dark", endpointId: "ep-1" }
  );
  const query = parseWiresharkPageSearch(`?${search}`);
  assert.deepEqual(query.sessions, [
    { sessionId: "s1", label: "1/1/c1/1, 1/1/c2/1" },
    { sessionId: "s2" },
    { sessionId: "s3", label: "e1-3" }
  ]);
  assert.equal(query.endpointId, "ep-1");
  assert.equal(query.theme, "dark");
  assert.deepEqual(sessionTabLabels(query.sessions), ["1/1/c1/1, 1/1/c2/1", "Capture 2", "e1-3"]);
});

test("page query parsing covers pending, embedded and defaults", () => {
  assert.deepEqual(parseWiresharkPageSearch(`?${buildPendingWiresharkPageSearch("light")}`), {
    sessions: [],
    theme: "light",
    showVolumeTip: true,
    embedded: false,
    pending: true
  });

  const embedded = parseWiresharkPageSearch(
    `?${buildEmbeddedWiresharkPageSearch("s2", { theme: "dark", endpointId: "ep-1", showVolumeTip: false })}`
  );
  assert.deepEqual(embedded, {
    sessions: [{ sessionId: "s2" }],
    endpointId: "ep-1",
    theme: "dark",
    showVolumeTip: false,
    embedded: true,
    pending: false
  });

  const blank = parseWiresharkPageSearch("?sessionId=%20&sessionId=s1&label=skipped&label=eth1");
  assert.deepEqual(blank.sessions, [{ sessionId: "s1", label: "eth1" }]);
});

test("the window title names the captured interfaces", () => {
  assert.equal(
    wiresharkPageTitle([{ sessionId: "s1", label: "1/1/1" }, { sessionId: "s2", label: "1/1/2" }]),
    "Wireshark · 1/1/1, 1/1/2"
  );
  assert.equal(wiresharkPageTitle([{ sessionId: "s1" }]), "Wireshark Capture");
});

test("created sessions keep request order and get tab names", () => {
  const requests = [request("1/1/c1/1", "e1-1"), request("1/1/c2/1, 1/1/c3/1", "e1-2", "e1-3")];
  // The second request was split by the API into two sessions.
  const created = [[session("a", ["e1-1"])], [session("b", ["e1-2"]), session("c", ["e1-3"])]];
  assert.deepEqual(labelCreatedSessions(requests, created), [
    { sessionId: "a", label: "1/1/c1/1" },
    { sessionId: "b", label: "e1-2" },
    { sessionId: "c", label: "e1-3" }
  ]);
});

test("sessions from several nodes name their node", () => {
  const created = [
    [session("a", ["e1-1"]), { ...session("b", ["eth1"], "clab-demo-client1"), showVolumeTip: true }]
  ];
  assert.deepEqual(labelCreatedSessions([request(undefined, "e1-1", "eth1")], created), [
    { sessionId: "a", label: "srl1: e1-1" },
    { sessionId: "b", label: "client1: eth1", showVolumeTip: true }
  ]);
});

test("labels that already name their node are kept, e.g. the ends of a link", () => {
  const created = [[session("a", ["clab-s-1"], "clab-demo-sr1")], [session("b", ["clab-s-2"])]];
  assert.deepEqual(
    labelCreatedSessions([request("sr1 · 1/1/c1/1", "1/1/c1/1"), request("srl1 · e1-1", "e1-1")], created),
    [
      { sessionId: "a", label: "sr1 · 1/1/c1/1" },
      { sessionId: "b", label: "srl1 · e1-1" }
    ]
  );
});

test("captures sent within one task are handed over together", async () => {
  const batches: number[][] = [];
  const queue = createCaptureBatcher<number>((items) => batches.push(items));
  queue(1);
  queue(2);
  queue(3);
  assert.deepEqual(batches, []);
  await Promise.resolve();
  queue(4);
  await Promise.resolve();
  assert.deepEqual(batches, [[1, 2, 3], [4]]);
});

interface FakeWindow {
  url: string;
  closed: boolean;
  replacedWith?: string;
  close(): void;
  location: { replace(url: string): void };
}

function fakeWindow(url: string): FakeWindow {
  const win: FakeWindow = {
    url,
    closed: false,
    close() {
      win.closed = true;
    },
    location: {
      replace(next: string) {
        win.replacedWith = next;
      }
    }
  };
  return win;
}

interface FakeHost extends WiresharkLaunchHost {
  windows: FakeWindow[];
  closedSessions: string[];
  notices: Array<[string, string]>;
}

function fakeHost(options: {
  desktop?: boolean;
  blockAfter?: number;
  responses: Array<CaptureWiresharkVncSession[] | Error | Promise<CaptureWiresharkVncSession[]>>;
}): FakeHost {
  let call = 0;
  const host: FakeHost = {
    windows: [],
    closedSessions: [],
    notices: [],
    desktop: options.desktop === true,
    pageUrl: (search) => `/wireshark.html?${search}`,
    openWindow(url) {
      if (options.desktop === true || host.windows.length >= (options.blockAfter ?? Infinity)) {
        return null;
      }
      const win = fakeWindow(url);
      host.windows.push(win);
      return win as unknown as Window;
    },
    async createSessions() {
      const response = options.responses[call++];
      if (response instanceof Error) throw response;
      return await (response ?? []);
    },
    closeSession(sessionId) {
      host.closedSessions.push(sessionId);
    },
    notify(message, severity) {
      host.notices.push([severity, message]);
    }
  };
  return host;
}

test("the browser opens one pending window during the click and loads every session into it", async () => {
  let resolveFirst: (sessions: CaptureWiresharkVncSession[]) => void = () => undefined;
  const first = new Promise<CaptureWiresharkVncSession[]>((resolve) => {
    resolveFirst = resolve;
  });
  const host = fakeHost({ responses: [first, [session("b", ["e1-2"])]] });

  const launched = launchWiresharkCapture(
    [request("1/1/c1/1", "e1-1"), request("1/1/c2/1", "e1-2")],
    { theme: "light", endpointId: "ep-1" },
    host
  );
  // Opened synchronously, before any session exists.
  assert.equal(host.windows.length, 1);
  assert.equal(host.windows[0]?.url, "/wireshark.html?pending=1&theme=light");

  resolveFirst([session("a", ["e1-1"])]);
  assert.equal(await launched, 2);
  assert.equal(host.windows.length, 1);
  assert.equal(
    host.windows[0]?.replacedWith,
    "/wireshark.html?sessionId=a&sessionId=b&label=1%2F1%2Fc1%2F1&label=1%2F1%2Fc2%2F1&theme=light&endpointId=ep-1"
  );
  assert.deepEqual(host.notices, []);
});

test("a failed or empty capture closes the pending window and says why", async () => {
  const failed = fakeHost({ responses: [new Error("image pull failed")] });
  assert.equal(await launchWiresharkCapture([request("e1-1", "e1-1")], { theme: "dark" }, failed), 0);
  assert.equal(failed.windows[0]?.closed, true);
  assert.deepEqual(failed.notices, [["error", "image pull failed"]]);

  const empty = fakeHost({ responses: [[]] });
  assert.equal(await launchWiresharkCapture([request("e1-1", "e1-1")], { theme: "dark" }, empty), 0);
  assert.equal(empty.windows[0]?.closed, true);
  assert.deepEqual(empty.notices, [["warning", "No Wireshark sessions were created."]]);
});

test("a partial failure still shows the sessions that were created", async () => {
  const host = fakeHost({ responses: [new Error("eth9 not found"), [session("b", ["e1-2"])]] });
  assert.equal(
    await launchWiresharkCapture([request("eth9", "eth9"), request("e1-2", "e1-2")], { theme: "dark" }, host),
    1
  );
  assert.equal(host.windows[0]?.replacedWith, "/wireshark.html?sessionId=b&label=e1-2&theme=dark");
  assert.deepEqual(host.notices, [["error", "eth9 not found"]]);
});

test("a blocked pop-up is retried once, then reported and its sessions closed", async () => {
  const blockedTwice = fakeHost({ blockAfter: 0, responses: [[session("a", ["e1-1"])]] });
  assert.equal(await launchWiresharkCapture([request("e1-1", "e1-1")], { theme: "dark" }, blockedTwice), 0);
  assert.deepEqual(blockedTwice.closedSessions, ["a"]);
  assert.deepEqual(blockedTwice.notices, [["error", POPUP_BLOCKED_MESSAGE]]);

  let blocked = true;
  const late = fakeHost({ responses: [[session("a", ["e1-1"])]] });
  const openWindow = late.openWindow.bind(late);
  late.openWindow = (url) => {
    if (blocked) {
      blocked = false;
      return null;
    }
    return openWindow(url);
  };
  assert.equal(await launchWiresharkCapture([request("e1-1", "e1-1")], { theme: "dark" }, late), 1);
  assert.equal(late.windows[0]?.url, "/wireshark.html?sessionId=a&label=e1-1&theme=dark");
  assert.deepEqual(late.notices, []);
});

test("closing the pending window before the sessions exist cancels them", async () => {
  let resolveSessions: (sessions: CaptureWiresharkVncSession[]) => void = () => undefined;
  const host = fakeHost({
    responses: [
      new Promise<CaptureWiresharkVncSession[]>((resolve) => {
        resolveSessions = resolve;
      })
    ]
  });
  const launched = launchWiresharkCapture([request("e1-1", "e1-1")], { theme: "dark" }, host);
  host.windows[0]?.close();
  resolveSessions([session("a", ["e1-1"])]);
  assert.equal(await launched, 0);
  assert.deepEqual(host.closedSessions, ["a"]);
  assert.deepEqual(host.notices, []);
});

test("the desktop app gets the final page once, after the sessions exist", async () => {
  const opened: string[] = [];
  const host = fakeHost({ desktop: true, responses: [[session("a", ["e1-1"]), session("b", ["e1-2"])]] });
  host.openWindow = (url) => {
    opened.push(url);
    return null;
  };
  assert.equal(await launchWiresharkCapture([request(undefined, "e1-1", "e1-2")], { theme: "dark" }, host), 2);
  assert.deepEqual(opened, ["/wireshark.html?sessionId=a&sessionId=b&label=e1-1&label=e1-2&theme=dark"]);
  assert.deepEqual(host.closedSessions, []);
  assert.deepEqual(host.notices, []);
});
