import assert from "node:assert/strict";
import { Duplex } from "node:stream";
import test from "node:test";

import type Docker from "dockerode";

import type { TerminalServerMessage, TerminalStream } from "../contract/backend.ts";
import { LocalTerminals, Scrollback } from "./terminals.ts";

/** A docker exec whose shell echoes its input, and exits on "exit". */
function echoDocker(): { docker: () => Docker; execs: () => number } {
  let execs = 0;
  const docker = {
    getContainer: () => ({
      exec: async () => {
        execs += 1;
        let stream: Duplex;
        stream = new Duplex({
          read() {},
          write(chunk: Buffer, _encoding, callback) {
            const text = chunk.toString();
            if (text.includes("exit")) {
              stream.push(null);
            } else {
              stream.push(`echo:${text}`);
            }
            callback();
          }
        });
        return {
          start: async () => stream,
          resize: async () => {},
          inspect: async () => ({ ExitCode: 0 })
        };
      }
    })
  };
  return { docker: () => docker as unknown as Docker, execs: () => execs };
}

const target = {
  labName: "lab",
  nodeName: "n1",
  containerId: "c1",
  kind: "linux",
  ipv4Address: "172.20.20.2/24"
};

function collect(stream: TerminalStream): { messages: TerminalServerMessage[]; output: () => string } {
  const messages: TerminalServerMessage[] = [];
  stream.onMessage((message) => messages.push(message));
  return {
    messages,
    output: () =>
      messages
        .filter((message) => message.type === "output")
        .map((message) => Buffer.from(message.data, "base64").toString())
        .join("")
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

test("a resumable terminal keeps running after the client disconnects and replays its output", async () => {
  const { docker, execs } = echoDocker();
  const terminals = new LocalTerminals(docker, "alice");
  const { sessionId, resumable } = terminals.create(target, {
    protocol: "shell",
    cols: 80,
    rows: 24,
    resumable: true
  });
  assert.equal(resumable, true);

  const first = await terminals.attach(sessionId);
  const firstOutput = collect(first);
  first.send({ type: "input", data: "one" });
  await settle();
  assert.equal(firstOutput.output(), "echo:one");
  first.close();
  assert.equal(terminals.get(sessionId).attached, false);

  const second = await terminals.attach(sessionId);
  const secondOutput = collect(second);
  const ready = secondOutput.messages[0];
  assert.ok(ready.type === "ready");
  assert.equal(ready.replay, true);
  assert.equal(ready.resumable, true);
  second.send({ type: "input", data: "two" });
  await settle();
  assert.equal(secondOutput.output(), "echo:oneecho:two");
  assert.equal(execs(), 1, "the shell started once");
  terminals.dispose();
});

test("a terminal that is not resumable ends when its client disconnects", async () => {
  const { docker } = echoDocker();
  const terminals = new LocalTerminals(docker, "alice");
  const { sessionId, resumable } = terminals.create(target, { protocol: "shell", cols: 80, rows: 24 });
  assert.equal(resumable, false);
  const stream = await terminals.attach(sessionId);
  const { messages } = collect(stream);
  assert.equal(messages[0]?.type === "ready" && messages[0].resumable, false);
  stream.close();
  assert.throws(() => terminals.get(sessionId), /not found/);
  terminals.dispose();
});

test("attaching again takes the session over from the previous client", async () => {
  const { docker } = echoDocker();
  const terminals = new LocalTerminals(docker, "alice");
  const { sessionId } = terminals.create(target, { protocol: "shell", cols: 80, rows: 24 });
  const first = await terminals.attach(sessionId);
  const closes: Array<{ reason: string; takenOver: boolean }> = [];
  first.onClose((reason, details) => closes.push({ reason, ...details }));

  const second = await terminals.attach(sessionId);
  assert.deepEqual(closes, [{ reason: "Terminal attached elsewhere", takenOver: true }]);
  // The replaced client disconnecting must neither detach the new one nor end the session.
  first.close();
  assert.equal(terminals.get(sessionId).attached, true);
  second.close();
  terminals.dispose();
});

test("an explicit close ends the session", async () => {
  const { docker } = echoDocker();
  const terminals = new LocalTerminals(docker, "alice");
  const { sessionId } = terminals.create(target, { protocol: "shell", cols: 80, rows: 24 });
  const stream = await terminals.attach(sessionId);
  const { messages } = collect(stream);
  stream.send({ type: "input", data: "exit" });
  await settle();
  assert.equal(messages.at(-1)?.type, "exit");
  assert.throws(() => terminals.get(sessionId), /not found/);
  terminals.dispose();
});

test("the scrollback keeps the newest output from the start of a line", () => {
  const scrollback = new Scrollback(16);
  scrollback.write(Buffer.from("old line\n"));
  scrollback.write(Buffer.from("0123456789\nnewest\n"));
  assert.equal(scrollback.read().toString(), "newest\n");
});
