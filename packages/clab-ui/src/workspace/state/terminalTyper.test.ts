import assert from "node:assert/strict";
import test from "node:test";

import { TerminalTyper, terminalInputLines } from "./terminalTyper";

/** A clock and timers that only move when the test says so. */
class FakeTime {
  now = 0;
  private timers: Array<{ at: number; callback: () => void; id: number }> = [];
  private nextId = 1;

  setTimer = (callback: () => void, ms: number): (() => void) => {
    const id = this.nextId++;
    this.timers.push({ at: this.now + ms, callback, id });
    return () => {
      this.timers = this.timers.filter((timer) => timer.id !== id);
    };
  };

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at).at(0);
      if (due === undefined) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.now = due.at;
      due.callback();
    }
    this.now = end;
  }
}

function typer(time: FakeTime, sent: string[], open = (): boolean => true): TerminalTyper {
  return new TerminalTyper({
    send: (data) => {
      if (!open()) return false;
      sent.push(data);
      return true;
    },
    now: () => time.now,
    setTimer: time.setTimer
  });
}

test("text becomes typed lines ending with Enter", () => {
  assert.deepEqual(terminalInputLines("enter candidate\ncommit now\n\n"), ["enter candidate\r", "commit now\r"]);
  assert.deepEqual(terminalInputLines("a\r\nb"), ["a\r", "b\r"]);
  assert.deepEqual(terminalInputLines("\n"), []);
});

test("the first line waits for a starting CLI to go quiet", () => {
  const time = new FakeTime();
  const sent: string[] = [];
  const terminal = typer(time, sent);
  terminal.type("show version");

  // The CLI prints its banner over a moment.
  for (let index = 0; index < 5; index += 1) {
    time.advance(200);
    terminal.noteOutput();
  }
  assert.deepEqual(sent, []);
  time.advance(1000);
  assert.deepEqual(sent, ["show version\r"]);
});

test("each later line waits for the previous one's answer", () => {
  const time = new FakeTime();
  const sent: string[] = [];
  const terminal = typer(time, sent);
  terminal.type("one\ntwo\nthree");
  time.advance(1000);
  assert.deepEqual(sent, ["one\r"]);

  // The answer to "one" keeps coming for a while.
  time.advance(200);
  terminal.noteOutput();
  time.advance(200);
  terminal.noteOutput();
  assert.deepEqual(sent, ["one\r"]);
  time.advance(300);
  assert.deepEqual(sent, ["one\r", "two\r"]);
  time.advance(300);
  assert.deepEqual(sent, ["one\r", "two\r", "three\r"]);
});

test("a terminal that never goes quiet still gets its lines", () => {
  const time = new FakeTime();
  const sent: string[] = [];
  const terminal = typer(time, sent);
  terminal.type("stop");
  for (let elapsed = 0; elapsed < 9900; elapsed += 100) {
    time.advance(100);
    terminal.noteOutput();
  }
  assert.deepEqual(sent, []);
  time.advance(200);
  assert.deepEqual(sent, ["stop\r"]);
});

test("lines wait for a connection that cannot take them yet", () => {
  const time = new FakeTime();
  const sent: string[] = [];
  let open = false;
  const terminal = typer(time, sent, () => open);
  terminal.type("uptime");
  time.advance(3000);
  assert.deepEqual(sent, []);
  open = true;
  time.advance(100);
  assert.deepEqual(sent, ["uptime\r"]);
});

test("a disposed typer types nothing more", () => {
  const time = new FakeTime();
  const sent: string[] = [];
  const terminal = typer(time, sent);
  terminal.type("one\ntwo");
  time.advance(1000);
  terminal.dispose();
  time.advance(5000);
  terminal.type("three");
  time.advance(5000);
  assert.deepEqual(sent, ["one\r"]);
});
