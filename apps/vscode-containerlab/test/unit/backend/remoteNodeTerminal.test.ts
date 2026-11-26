/* global describe, it, before, after, beforeEach, afterEach */
/**
 * Tests for the terminal of a node on a lab host: what is typed into it
 * before its session takes input, as a lab guide's terminal block is, must
 * not be lost.
 */
import Module from "module";
import path from "path";

import { expect } from "chai";
import sinon from "sinon";

import type { StubTerminal } from "../../helpers/vscode-stub";

const originalResolve = (Module as any)._resolveFilename;

function clearModuleCache() {
  Object.keys(require.cache).forEach((key) => {
    if (key.includes("vscode-containerlab") && !key.includes("node_modules")) {
      delete require.cache[key];
    }
  });
}

type Message = { type: string; data?: string; resumable?: boolean };

/** One attachment to a terminal session, as the lab host's stream. */
class FakeStream {
  readonly sent: Message[] = [];
  private messageListener: ((message: Message) => void) | undefined;
  private closeListener: ((reason: string, info: { takenOver: boolean }) => void) | undefined;

  onMessage(listener: (message: Message) => void): void {
    this.messageListener = listener;
  }
  onClose(listener: (reason: string, info: { takenOver: boolean }) => void): void {
    this.closeListener = listener;
  }
  send(message: Message): void {
    this.sent.push(message);
  }
  close(): void {}

  emit(message: Message): void {
    this.messageListener?.(message);
  }
  drop(reason: string): void {
    this.closeListener?.(reason, { takenOver: false });
  }
  inputs(): string[] {
    return this.sent.filter((message) => message.type === "input").map((message) => message.data ?? "");
  }
}

let streams: FakeStream[] = [];
const backend = {
  createTerminal: async () => ({ sessionId: "session-1" }),
  attachTerminal: async () => {
    const stream = new FakeStream();
    streams.push(stream);
    return stream;
  },
  getTerminal: async () => ({ state: "open" }),
  closeTerminal: async () => {}
};

interface Pty {
  open(dimensions: undefined): void;
  handleInput(data: string): void;
  close(): void;
}

describe("a node's terminal on a lab host", () => {
  let clock: sinon.SinonFakeTimers;
  let terminal: StubTerminal;
  let pty: Pty;
  let vscodeStub: any;
  let openRemoteTerminal: (node: unknown, protocol: string, title: string) => Promise<void>;
  let remoteTerminalAttached: (terminal: { creationOptions: Record<string, unknown> }) => Promise<void>;

  before(() => {
    clearModuleCache();
    (Module as any)._resolveFilename = function (
      request: string,
      parent: any,
      isMain: boolean,
      options: any
    ) {
      if (request === "vscode") {
        return path.join(__dirname, "..", "..", "helpers", "vscode-stub.js");
      }
      return originalResolve.call(this, request, parent, isMain, options);
    };
    // The node is on a lab host whose backend is the fake above.
    const labBackendsPath = require.resolve("../../../src/backend/labBackends");
    (require.cache as any)[labBackendsPath] = {
      exports: {
        backendOf: () => backend,
        connectionOf: () => ({ id: "host", label: "host", kind: "api" }),
        isRemote: () => true
      }
    };
    vscodeStub = require("../../helpers/vscode-stub");
    ({ openRemoteTerminal, remoteTerminalAttached } = require("../../../src/backend/remoteNode"));
  });

  after(() => {
    (Module as any)._resolveFilename = originalResolve;
    clearModuleCache();
  });

  beforeEach(async () => {
    streams = [];
    vscodeStub.window.terminals.length = 0;
    clock = sinon.useFakeTimers();
    await openRemoteTerminal({ name: "clab-lab-r1", labName: "lab" }, "shell", "Shell - clab-lab-r1");
    [terminal] = vscodeStub.window.terminals;
    pty = terminal.creationOptions.pty as Pty;
  });

  afterEach(() => {
    pty.close();
    clock.restore();
    vscodeStub.window.terminals.length = 0;
  });

  it("keeps what is typed until the session takes input, in order", async () => {
    let attached = false;
    void remoteTerminalAttached(terminal).then(() => {
      attached = true;
    });

    pty.open(undefined);
    // Typed while the session is created, and again once its stream is there.
    pty.handleInput("enter candidate\r");
    await clock.tickAsync(0);
    pty.handleInput("commit now\r");
    await clock.tickAsync(0);
    const [stream] = streams;
    expect(stream.inputs()).to.deep.equal([]);
    expect(attached).to.equal(false);

    stream.emit({ type: "ready", resumable: true });
    await clock.tickAsync(0);
    expect(stream.inputs()).to.deep.equal(["enter candidate\r", "commit now\r"]);
    expect(attached).to.equal(true);

    pty.handleInput("show version\r");
    expect(stream.inputs()).to.deep.equal(["enter candidate\r", "commit now\r", "show version\r"]);
  });

  it("keeps what is typed while a dropped connection comes back", async () => {
    pty.open(undefined);
    await clock.tickAsync(0);
    streams[0].emit({ type: "ready", resumable: true });

    streams[0].drop("Connection lost");
    pty.handleInput("commit now\r");
    expect(streams[0].inputs()).to.deep.equal([]);

    await clock.tickAsync(1_000);
    expect(streams).to.have.length(2);
    expect(streams[1].inputs()).to.deep.equal([]);
    streams[1].emit({ type: "ready", resumable: true });
    expect(streams[1].inputs()).to.deep.equal(["commit now\r"]);
  });

  it("stops waiting when the terminal closes before it attached", async () => {
    let attached = false;
    void remoteTerminalAttached(terminal).then(() => {
      attached = true;
    });
    pty.open(undefined);
    pty.handleInput("uptime\r");
    pty.close();
    await clock.tickAsync(0);
    expect(attached).to.equal(true);
    expect(streams.flatMap((stream) => stream.inputs())).to.deep.equal([]);
  });

  it("has nothing to wait for on a terminal that is not a lab host's", async () => {
    let attached = false;
    void remoteTerminalAttached({ creationOptions: { name: "bash" } }).then(() => {
      attached = true;
    });
    await clock.tickAsync(0);
    expect(attached).to.equal(true);
  });
});
