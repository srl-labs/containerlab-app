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
    ready: open,
    now: () => time.now,
    setTimer: time.setTimer
  });
}

/** A typer on a terminal that already shows its prompt. */
function typerAtPrompt(time: FakeTime, sent: string[]): TerminalTyper {
  const terminal = typer(time, sent);
  terminal.noteOutput();
  return terminal;
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

test("the first line waits for a CLI that has printed nothing yet", () => {
  const time = new FakeTime();
  const sent: string[] = [];
  const terminal = typer(time, sent);
  terminal.type("enter candidate\ncommit now");

  // The shell is connected, but its CLI takes a while to show its banner.
  time.advance(2500);
  assert.deepEqual(sent, []);
  terminal.noteOutput();
  time.advance(900);
  assert.deepEqual(sent, []);
  time.advance(200);
  assert.deepEqual(sent, ["enter candidate\r"]);
  time.advance(400);
  assert.deepEqual(sent, ["enter candidate\r", "commit now\r"]);
});

test("a terminal that prints nothing still gets its lines in the end", () => {
  const time = new FakeTime();
  const sent: string[] = [];
  const terminal = typer(time, sent);
  terminal.type("uptime");
  time.advance(9900);
  assert.deepEqual(sent, []);
  time.advance(200);
  assert.deepEqual(sent, ["uptime\r"]);
});

test("each later line waits for the previous one's answer", () => {
  const time = new FakeTime();
  const sent: string[] = [];
  const terminal = typerAtPrompt(time, sent);
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
  // Longer than a line ever waits: the connection is what it waits for.
  time.advance(30000);
  assert.deepEqual(sent, []);

  // Connected, the terminal starts its CLI, and that still gets its quiet second.
  open = true;
  time.advance(500);
  terminal.noteOutput();
  time.advance(900);
  assert.deepEqual(sent, []);
  time.advance(200);
  assert.deepEqual(sent, ["uptime\r"]);
});

test("a disposed typer types nothing more and hands back what is left", () => {
  const time = new FakeTime();
  const sent: string[] = [];
  const terminal = typerAtPrompt(time, sent);
  terminal.type("one\ntwo\nthree");
  time.advance(1000);
  assert.deepEqual(terminal.dispose(), ["two", "three"]);
  time.advance(5000);
  terminal.type("four");
  time.advance(5000);
  assert.deepEqual(sent, ["one\r"]);
  assert.deepEqual(terminal.dispose(), []);
});
