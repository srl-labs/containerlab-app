import assert from "node:assert/strict";
import test from "node:test";

import { createEventChannel, type EventChannelTarget, type WebSocketLike } from "./eventChannel";
import type { EventSourceLike } from "./eventStreamManager";

class FakeSocket implements WebSocketLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly sent: Array<Record<string, unknown>> = [];
  closed = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  receive(message: Record<string, unknown>): void {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(message) }));
  }

  drop(): void {
    this.onerror?.(new Event("error"));
    this.onclose?.(new Event("close") as CloseEvent);
  }
}

class FakeEventSource implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(readonly target: EventChannelTarget) {}

  close(): void {
    this.closed = true;
  }
}

function harness() {
  let now = 0;
  let nextTimer = 1;
  const pending = new Map<number, { at: number; callback: () => void }>();
  const sockets: FakeSocket[] = [];
  const fallbacks: FakeEventSource[] = [];
  const channel = createEventChannel({
    connect: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    fallback: (target) => {
      const source = new FakeEventSource(target);
      fallbacks.push(source);
      return source;
    },
    timers: {
      setTimeout: (callback, ms) => {
        const id = nextTimer++;
        pending.set(id, { at: now + ms, callback });
        return id;
      },
      clearTimeout: (handle) => {
        pending.delete(handle as number);
      }
    }
  });
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].callback();
    }
    now = until;
  };
  return { channel, sockets, fallbacks, advance };
}

function record(source: EventSourceLike) {
  const log: string[] = [];
  source.onopen = () => log.push("open");
  source.onmessage = (event) => log.push(`message ${String(event.data)}`);
  source.onerror = (event) => log.push(`error${"data" in event ? ` ${String(event.data)}` : ""}`);
  return log;
}

test("streams of several lab hosts share one socket", () => {
  const { channel, sockets } = harness();
  const events = record(channel.open({ stream: "events", endpointId: "a" }));
  const files = record(channel.open({ stream: "files", endpointId: "b" }));
  channel.open({ stream: "topology", endpointId: "a", sessionId: "s1" });
  assert.equal(sockets.length, 1);
  const [socket] = sockets;
  assert.deepEqual(socket.sent, [], "nothing is sent before the socket opens");

  socket.open();
  assert.deepEqual(socket.sent, [
    { type: "open", id: "1", stream: "events", endpointId: "a" },
    { type: "open", id: "2", stream: "files", endpointId: "b" },
    { type: "open", id: "3", stream: "topology", endpointId: "a", sessionId: "s1" }
  ]);

  socket.receive({ id: "1", type: "open" });
  socket.receive({ id: "1", type: "event", data: "{\"x\":1}" });
  socket.receive({ id: "2", type: "event", data: "{\"y\":2}" });
  socket.receive({ id: "1", type: "error", error: "upstream failed" });
  assert.deepEqual(events, ["open", "message {\"x\":1}", "error {\"error\":\"upstream failed\"}"]);
  assert.deepEqual(files, ["message {\"y\":2}"]);
});

test("a stream that ends opens again after the retry delay, like an EventSource", () => {
  const { channel, sockets, advance } = harness();
  const log = record(channel.open({ stream: "files", endpointId: "a" }));
  const [socket] = sockets;
  socket.open();
  socket.receive({ id: "1", type: "open" });
  socket.receive({ id: "1", type: "end" });
  assert.deepEqual(log, ["open", "error"]);

  advance(3000);
  assert.deepEqual(socket.sent.at(-1), { type: "open", id: "2", stream: "files", endpointId: "a" });
  assert.equal(sockets.length, 1, "the socket stays open between the two");
});

test("closing a stream from its error handler stops the retry", () => {
  const { channel, sockets, advance } = harness();
  const source = channel.open({ stream: "events", endpointId: "a" });
  source.onerror = () => source.close();
  const [socket] = sockets;
  socket.open();
  socket.receive({ id: "1", type: "end" });
  advance(10_000);
  assert.equal(socket.sent.filter((message) => message.type === "open").length, 1);
  assert.equal(socket.closed, true, "the unused socket closes after a while");
});

test("closing a stream tells the server, and a refused stream stays closed", () => {
  const { channel, sockets, advance } = harness();
  const open = channel.open({ stream: "events", endpointId: "a" });
  const refusedLog = record(channel.open({ stream: "topology", endpointId: "a", sessionId: "gone" }));
  const [socket] = sockets;
  socket.open();
  open.close();
  assert.deepEqual(socket.sent.at(-1), { type: "close", id: "1" });

  socket.receive({ id: "2", type: "refused", status: 404, error: "Topology session not found" });
  advance(10_000);
  assert.deepEqual(refusedLog, ["error"]);
  assert.equal(socket.sent.filter((message) => message.type === "open").length, 2);
});

test("a dropped socket fails every stream, and they reconnect on a new socket", () => {
  const { channel, sockets, advance } = harness();
  const first = record(channel.open({ stream: "events", endpointId: "a" }));
  const second = record(channel.open({ stream: "files", endpointId: "b" }));
  sockets[0].open();
  sockets[0].drop();
  assert.deepEqual(first, ["error"], "one error per drop, not one per socket event");
  assert.deepEqual(second, ["error"]);

  advance(3000);
  assert.equal(sockets.length, 2);
  sockets[1].open();
  assert.deepEqual(
    sockets[1].sent.map((message) => message.stream),
    ["events", "files"]
  );
});

test("a socket that stays silent past the server's pings counts as dropped", () => {
  const { channel, sockets, advance } = harness();
  const log = record(channel.open({ stream: "events", endpointId: "a" }));
  sockets[0].open();
  advance(50_000);
  sockets[0].receive({ type: "ping" });
  advance(50_000);
  assert.deepEqual(log, [], "pings keep the socket alive");
  advance(20_000);
  assert.deepEqual(log, ["error"]);
  assert.equal(sockets[0].closed, true);
});

test("a stream refused as signed out opens the next stream on a fresh socket", () => {
  const { channel, sockets } = harness();
  channel.open({ stream: "events", endpointId: "a" });
  sockets[0].open();
  sockets[0].receive({ id: "1", type: "refused", status: 401, error: "Not authenticated" });
  channel.open({ stream: "events", endpointId: "a" });
  assert.equal(sockets.length, 2, "the new socket carries the current session cookie");
  assert.equal(sockets[0].closed, true);
});

test("uses the SSE routes when WebSockets never get through", () => {
  const { channel, sockets, fallbacks, advance } = harness();
  const log = record(channel.open({ stream: "topology", endpointId: "a", sessionId: "s1" }));
  sockets[0].drop();
  advance(3000);
  sockets[1].drop();
  assert.deepEqual(log, ["error", "error"]);
  advance(3000);
  assert.equal(sockets.length, 2, "no third socket");
  assert.deepEqual(fallbacks.map((source) => source.target), [{ stream: "topology", endpointId: "a", sessionId: "s1" }]);

  fallbacks[0].onopen?.(new Event("open"));
  fallbacks[0].onmessage?.(new MessageEvent("message", { data: "{}" }));
  assert.deepEqual(log, ["error", "error", "open", "message {}"]);
});

test("a socket that worked once never falls back to SSE", () => {
  const { channel, sockets, fallbacks, advance } = harness();
  channel.open({ stream: "events", endpointId: "a" });
  sockets[0].open();
  sockets[0].drop();
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    advance(3000);
    sockets[attempt].drop();
  }
  assert.equal(fallbacks.length, 0);
});
