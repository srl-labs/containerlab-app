import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Duplex } from "node:stream";

import type Docker from "dockerode";
import { DEFAULT_EXEC_COMMANDS_BY_KIND, DEFAULT_SSH_USERS_BY_KIND } from "@containerlab/clab-ui/host";
import type { AnyAuthMethod, ClientChannel, ConnectConfig } from "ssh2";

import type {
  TerminalClientMessage,
  TerminalCreateOptions,
  TerminalServerMessage,
  TerminalStream
} from "../contract/backend.ts";
import type { TerminalProtocol, TerminalSessionInfo } from "../contract/dto.ts";
import { LabBackendError } from "../contract/errors.ts";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** A resumable session without a client ends this long after the client left. */
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
/** Recent output replayed to a client that attaches again. */
const SCROLLBACK_BYTES = 256 * 1024;
const DEFAULT_TELNET_PORT = 5000;
const SSH_USERNAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_-]{0,31}$/;

function kindDefault(defaults: Readonly<Record<string, string>>, kind: string): string | undefined {
  const key = kind.trim();
  return Object.hasOwn(defaults, key) ? defaults[key] : undefined;
}

/** The login shell of a node kind, as clab-api-server opens it. */
export function terminalShellCommand(kind: string): string[] {
  return kindDefault(DEFAULT_EXEC_COMMANDS_BY_KIND, kind)?.split(/\s+/) ?? ["sh"];
}

export function terminalSshUsername(kind: string, requested?: string): string {
  const trimmed = requested?.trim() ?? "";
  if (SSH_USERNAME_PATTERN.test(trimmed)) return trimmed;
  return kindDefault(DEFAULT_SSH_USERS_BY_KIND, kind) ?? "admin";
}

function clampSize(cols: number, rows: number): { cols: number; rows: number } {
  return {
    cols: Number.isInteger(cols) && cols >= 40 && cols <= 400 ? cols : 120,
    rows: Number.isInteger(rows) && rows >= 12 && rows <= 200 ? rows : 36
  };
}

/** What a terminal connects to. */
export interface TerminalTarget {
  labName: string;
  nodeName: string;
  containerId: string;
  kind: string;
  /** Management IPv4 address, for SSH. */
  ipv4Address: string;
}

/** A running terminal process: output in, input and size out. */
interface TerminalProcess {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

/** One client's view of a session. */
interface Attachment {
  emit(message: TerminalServerMessage): void;
  finish(reason: string, takenOver: boolean): void;
}

interface Session {
  info: TerminalSessionInfo;
  target: TerminalTarget;
  size: { cols: number; rows: number };
  sshUsername: string;
  telnetPort: number;
  attachment?: Attachment;
  /** When the last client left, or the creation time. */
  detachedAt: number;
  scrollback: Scrollback;
  process?: TerminalProcess;
  /** Set while the process starts, so concurrent attaches start it once. */
  starting?: Promise<void>;
}

/** The most recent output of a session, up to a byte limit. */
export class Scrollback {
  private chunks: Buffer[] = [];
  private size = 0;
  private readonly limit: number;

  constructor(limit = SCROLLBACK_BYTES) {
    this.limit = limit;
  }

  write(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size - (this.chunks[0]?.length ?? 0) >= this.limit) {
      this.size -= this.chunks.shift()?.length ?? 0;
    }
  }

  /** The kept output, from the start of a line where the oldest output was cut. */
  read(): Buffer {
    let data = Buffer.concat(this.chunks);
    if (data.length > this.limit) {
      data = data.subarray(data.length - this.limit);
      const newline = data.subarray(0, 4096).indexOf(0x0a);
      if (newline >= 0) data = data.subarray(newline + 1);
    }
    return data;
  }
}

type ProcessEvents = {
  output(data: Buffer): void;
  exit(exitCode: number | null, error?: string): void;
};

/**
 * Node terminals on this machine: docker exec for shell and telnet, SSH for
 * ssh. A resumable session keeps running when its client disconnects, and
 * replays its recent output to the next one; any other session ends with its
 * client, as on clab-api-server.
 */
export class LocalTerminals {
  private readonly sessions = new Map<string, Session>();

  private readonly docker: () => Docker;
  private readonly username: string;
  private cleanupTimer: ReturnType<typeof setInterval> | undefined;

  constructor(docker: () => Docker, username: string) {
    this.docker = docker;
    this.username = username;
  }

  create(target: TerminalTarget, options: TerminalCreateOptions): TerminalSessionInfo {
    const protocol = options.protocol;
    if (protocol !== "ssh" && protocol !== "shell" && protocol !== "telnet") {
      throw new LabBackendError(`unsupported terminal protocol "${String(protocol)}"`, 400);
    }
    this.cleanup();
    const now = new Date();
    const sessionId = randomBytes(16).toString("hex");
    const info: TerminalSessionInfo = {
      sessionId,
      username: this.username,
      labName: target.labName,
      nodeName: target.nodeName,
      protocol,
      state: "ready",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
      lastActivity: now.toISOString(),
      resumable: options.resumable === true
    };
    this.sessions.set(sessionId, {
      info,
      target,
      size: clampSize(options.cols, options.rows),
      sshUsername: terminalSshUsername(target.kind, options.sshUsername),
      telnetPort:
        options.telnetPort && options.telnetPort > 0 && options.telnetPort <= 65535
          ? options.telnetPort
          : DEFAULT_TELNET_PORT,
      detachedAt: now.getTime(),
      scrollback: new Scrollback()
    });
    this.cleanupTimer ??= setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
    return { ...info };
  }

  get(sessionId: string): TerminalSessionInfo {
    const session = this.session(sessionId);
    return { ...session.info, attached: session.attachment !== undefined };
  }

  close(sessionId: string): void {
    this.end(sessionId, this.session(sessionId));
  }

  private end(sessionId: string, session: Session): void {
    session.process?.kill();
    session.info.state = "closed";
    if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
  }

  dispose(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    for (const session of this.sessions.values()) session.process?.kill();
    this.sessions.clear();
  }

  /**
   * Attaches a client. A client that is still attached is told it was taken
   * over, so a reloaded page continues the session it had.
   */
  async attach(sessionId: string): Promise<TerminalStream> {
    const session = this.session(sessionId);
    if (session.info.state === "closed") {
      throw new LabBackendError("Terminal session already exited", 410);
    }
    session.attachment?.finish("Terminal attached elsewhere", true);

    const messageListeners = new Set<(message: TerminalServerMessage) => void>();
    const closeListeners = new Set<(reason: string, details: { takenOver: boolean }) => void>();
    const pending: TerminalServerMessage[] = [];
    let closed: { reason: string; takenOver: boolean } | undefined;
    const attachment: Attachment = {
      emit: (message) => {
        if (closed) return;
        if (messageListeners.size === 0) pending.push(message);
        for (const listener of messageListeners) listener(message);
      },
      finish: (reason, takenOver) => {
        if (closed) return;
        closed = { reason, takenOver };
        if (session.attachment === attachment) {
          session.attachment = undefined;
          session.detachedAt = Date.now();
        }
        for (const listener of closeListeners) listener(reason, { takenOver });
      }
    };
    session.attachment = attachment;

    const replay = session.scrollback.read();
    attachment.emit({
      type: "ready",
      sessionId,
      protocol: session.info.protocol,
      createdAt: session.info.createdAt,
      expiresAt: session.info.expiresAt,
      resumable: session.info.resumable === true,
      replay: replay.length > 0
    });
    if (replay.length > 0) {
      attachment.emit({ type: "output", data: replay.toString("base64"), encoding: "base64" });
    }

    session.starting ??= this.startProcess(sessionId, session);
    await session.starting;

    return {
      send: (message: TerminalClientMessage) => {
        const terminal = session.process;
        if (!terminal || closed) return;
        switch (message.type) {
          case "input":
            terminal.write(message.data);
            break;
          case "resize":
            session.size = clampSize(message.cols, message.rows);
            terminal.resize(session.size.cols, session.size.rows);
            break;
          case "close":
            terminal.kill();
            break;
        }
      },
      onMessage(listener) {
        messageListeners.add(listener);
        for (const message of pending.splice(0)) listener(message);
        return () => messageListeners.delete(listener);
      },
      onClose(listener) {
        if (closed) {
          listener(closed.reason, { takenOver: closed.takenOver });
          return () => {};
        }
        closeListeners.add(listener);
        return () => closeListeners.delete(listener);
      },
      close: () => {
        const current = session.attachment === attachment;
        attachment.finish("Client disconnected", false);
        // Disconnecting leaves only a resumable session running for the next attach.
        if (current && session.info.resumable !== true) this.end(sessionId, session);
      }
    };
  }

  /** Starts the session's process once; its output goes to the scrollback and the attached client. */
  private async startProcess(sessionId: string, session: Session): Promise<void> {
    const events: ProcessEvents = {
      output: (data) => {
        session.info.lastActivity = new Date().toISOString();
        session.scrollback.write(data);
        session.attachment?.emit({ type: "output", data: data.toString("base64"), encoding: "base64" });
      },
      exit: (exitCode, error) => {
        session.info.state = "closed";
        session.info.exitCode = exitCode;
        if (error) session.info.error = error;
        this.sessions.delete(sessionId);
        const attachment = session.attachment;
        attachment?.emit({ type: "exit", exitCode, ...(error ? { error } : {}), state: "closed" });
        attachment?.finish(error ?? "Terminal closed", false);
      }
    };
    try {
      session.process = await this.start(session, events);
      // The session may have been closed while its process started.
      if (session.info.state === "closed") session.process.kill();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      events.exit(null, message);
    }
  }

  private session(sessionId: string): Session {
    const session = this.sessions.get(sessionId.trim());
    if (!session) throw new LabBackendError("Terminal session not found", 404);
    return session;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      const expired = Date.parse(session.info.expiresAt) < now;
      const idle = !session.attachment && now - session.detachedAt > IDLE_TIMEOUT_MS;
      if (expired || idle) {
        session.process?.kill();
        this.sessions.delete(sessionId);
      }
    }
  }

  private start(session: Session, events: ProcessEvents): Promise<TerminalProcess> {
    const { target } = session;
    switch (session.info.protocol as TerminalProtocol) {
      case "shell":
        return this.dockerExec(target.containerId, terminalShellCommand(target.kind), session, events);
      case "telnet":
        return this.dockerExec(
          target.containerId,
          ["telnet", "127.0.0.1", String(session.telnetPort)],
          session,
          events
        );
      case "ssh":
        return startSsh(session, events);
    }
  }

  private async dockerExec(
    containerId: string,
    command: string[],
    session: Session,
    events: ProcessEvents
  ): Promise<TerminalProcess> {
    const docker = this.docker();
    const exec = await docker.getContainer(containerId).exec({
      Cmd: command,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Env: ["TERM=xterm-256color", "LANG=C.UTF-8"]
    });
    const stream = (await exec.start({ hijack: true, stdin: true, Tty: true })) as Duplex;
    let exited = false;
    const resize = (cols: number, rows: number) => {
      exec.resize({ w: cols, h: rows }).catch(() => {});
    };
    resize(session.size.cols, session.size.rows);
    stream.on("data", (chunk: Buffer) => events.output(chunk));
    const onEnd = () => {
      if (exited) return;
      exited = true;
      exec
        .inspect()
        .then((state) => events.exit(state.ExitCode ?? null))
        .catch(() => events.exit(null));
    };
    stream.on("end", onEnd);
    stream.on("close", onEnd);
    stream.on("error", (error: Error) => {
      if (exited) return;
      exited = true;
      events.exit(null, error.message);
    });
    return {
      write: (data) => {
        if (!stream.destroyed) stream.write(data);
      },
      resize,
      kill: () => {
        // A detached exec ends with its shell; ending input makes most shells exit.
        stream.end("\x04");
        stream.destroy();
      }
    };
  }
}

async function readPrivateKeys(): Promise<Buffer[]> {
  const keys: Buffer[] = [];
  for (const name of ["id_ed25519", "id_ecdsa", "id_rsa"]) {
    try {
      keys.push(await fs.readFile(path.join(os.homedir(), ".ssh", name)));
    } catch {
      // No such key.
    }
  }
  return keys;
}

/**
 * An SSH login to the node's management address. Keys from the SSH agent and
 * `~/.ssh` are tried first; a password is then asked for in the terminal.
 */
async function startSsh(session: Session, events: ProcessEvents): Promise<TerminalProcess> {
  const { Client } = await import("ssh2");
  const host = session.target.ipv4Address.split("/")[0]?.trim();
  if (!host || host === "N/A") {
    throw new LabBackendError("container management IP is required for SSH", 400);
  }
  const client = new Client();
  const keys = await readPrivateKeys();
  const username = session.sshUsername;
  let channel: ClientChannel | undefined;
  let passwordInput: ((data: string) => void) | undefined;
  let closed = false;
  const write = (text: string) => events.output(Buffer.from(text, "utf8"));

  const askPassword = (prompt: string) =>
    new Promise<string>((resolve) => {
      write(prompt);
      let value = "";
      passwordInput = (data) => {
        for (const char of data) {
          if (char === "\r" || char === "\n") {
            passwordInput = undefined;
            write("\r\n");
            resolve(value);
            return;
          }
          if (char === "\x7f" || char === "\b") {
            value = value.slice(0, -1);
          } else if (char === "\x03") {
            passwordInput = undefined;
            write("^C\r\n");
            client.end();
            return;
          } else {
            value += char;
          }
        }
      };
    });

  const methods: AnyAuthMethod[] = [];
  if (process.env.SSH_AUTH_SOCK) methods.push({ type: "agent", username, agent: process.env.SSH_AUTH_SOCK });
  for (const key of keys) methods.push({ type: "publickey", username, key });
  methods.push({
    type: "keyboard-interactive",
    username,
    prompt: (_name, _instructions, _lang, prompts, finish) => {
      void (async () => {
        const answers: string[] = [];
        for (const prompt of prompts) answers.push(await askPassword(prompt.prompt));
        finish(answers);
      })();
    }
  });
  let passwordAttempts = 0;

  const config: ConnectConfig = {
    host,
    port: 22,
    username,
    readyTimeout: 60_000,
    keepaliveInterval: 30_000,
    keepaliveCountMax: 3,
    hostVerifier: () => true,
    authHandler: (_methodsLeft, _partialSuccess, next) => {
      const method = methods.shift();
      if (method) {
        next(method);
        return;
      }
      if (passwordAttempts >= 3) {
        // ssh2 stops authenticating when the handler passes false.
        (next as unknown as (stop: false) => void)(false);
        return;
      }
      passwordAttempts += 1;
      void askPassword(`${username}@${host}'s password: `).then((password) =>
        next({ type: "password", username, password })
      );
    }
  };

  const exit = (exitCode: number | null, error?: string) => {
    if (closed) return;
    closed = true;
    events.exit(exitCode, error);
  };

  client.on("ready", () => {
    client.shell(
      { term: "xterm-256color", cols: session.size.cols, rows: session.size.rows },
      (error, stream) => {
        if (error) {
          exit(null, error.message);
          client.end();
          return;
        }
        channel = stream;
        stream.on("data", (chunk: Buffer) => events.output(chunk));
        stream.stderr.on("data", (chunk: Buffer) => events.output(chunk));
        stream.on("exit", (code: number | null) => exit(typeof code === "number" ? code : null));
        stream.on("close", () => {
          exit(0);
          client.end();
        });
      }
    );
  });
  client.on("error", (error) => {
    write(`\r\n${error.message}\r\n`);
    exit(255, error.message);
  });
  client.on("close", () => exit(channel ? 0 : 255));
  client.connect(config);

  return {
    write: (data) => {
      if (passwordInput) {
        passwordInput(data);
        return;
      }
      channel?.write(data);
    },
    resize: (cols, rows) => channel?.setWindow(rows, cols, 0, 0),
    kill: () => {
      channel?.close();
      client.end();
    }
  };
}
