/**
 * Wireshark VNC fed through a named pipe, for a c9s lab host on this machine.
 * The Wireshark VNC image (wireshark-vnc-docker with its
 * `CLABWIRE_CAPTURE_PIPE` mode) creates the pipe and runs
 * `wireshark -k -i <pipe>`; this machine writes the session's pcapng capture
 * into it through `<runtime> exec -i <container>`. The container needs no way
 * to reach this machine.
 */
import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

/** The variable that names the pipe in the Wireshark VNC image. */
export const CAPTURE_PIPE_ENV = "CLABWIRE_CAPTURE_PIPE";

/** Holds the capture pipe in the Wireshark VNC container. */
const CAPTURE_PIPE_DIR = "/tmp/clabwire/";

/**
 * Runs in the Wireshark VNC container for every capture written into the
 * pipe. It waits for the image to create the pipe (60 s, then exit 3), opens
 * it for writing, which blocks until Wireshark opens it for reading, reports
 * `open` on stdout and copies stdin into the pipe until stdin ends or
 * Wireshark closes the pipe.
 */
export const CAPTURE_PIPE_SCRIPT = `p="$${CAPTURE_PIPE_ENV}"
i=0
while [ ! -p "$p" ]; do
  i=$((i+1))
  if [ "$i" -gt 300 ]; then
    echo "Wireshark created no capture pipe $p; Wireshark VNC of a Kubernetes lab host needs a wireshark-vnc-docker image with ${CAPTURE_PIPE_ENV}" >&2
    exit 3
  fi
  sleep 0.2
done
exec 3>"$p"
echo open
cat >&3
exit 0`;

/** Keeps a pipe that Wireshark opens and closes at once from restarting the capture in a tight loop. */
const RETRY_DELAY_MS = 1000;

/** The pipe of a session's Wireshark; Wireshark shows it as the name of what it captures. */
export function capturePipePath(containerName: string): string {
  const name = containerName.replace(/[^A-Za-z0-9_.-]/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  return `${CAPTURE_PIPE_DIR}${name || "capture"}`;
}

/** Opens one pcapng capture of the session; it ends when `signal` aborts. */
export type OpenPipeCapture = (signal: AbortSignal) => Promise<AsyncIterable<Uint8Array>>;

export interface CapturePipeOptions {
  /** The container runtime CLI that runs the container, e.g. `docker`. */
  runtime: string;
  containerId: string;
  env?: NodeJS.ProcessEnv;
  open: OpenPipeCapture;
  /** Pause before the pipe is fed again; tests shorten it. */
  retryDelayMs?: number;
}

export interface CapturePipeFeed {
  /**
   * Settles when the feed ends: undefined after `stop()`, or the error of a
   * capture that failed or a pipe that never opened.
   */
  done: Promise<Error | undefined>;
  /** Ends the feed: the running capture stops, and the exec into the container. */
  stop(): void;
}

type ExecChild = ChildProcessByStdio<Writable, Readable, Readable>;

function write(stdin: Writable, chunk: Uint8Array): Promise<boolean> {
  return new Promise((resolve) => {
    if (stdin.destroyed || !stdin.writable) {
      resolve(false);
      return;
    }
    const flushed = stdin.write(chunk, (error) => {
      if (error) resolve(false);
    });
    if (flushed) {
      resolve(true);
      return;
    }
    const onDrain = () => {
      stdin.off("close", onClose);
      resolve(true);
    };
    const onClose = () => {
      stdin.off("drain", onDrain);
      resolve(false);
    };
    stdin.once("drain", onDrain);
    stdin.once("close", onClose);
  });
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/** `<runtime> exec -i <container> sh -c <script>`, with its exit and the moment the pipe opened. */
function execIntoPipe(options: CapturePipeOptions) {
  const child: ExecChild = spawn(
    options.runtime,
    ["exec", "-i", options.containerId, "sh", "-c", CAPTURE_PIPE_SCRIPT],
    { env: options.env, stdio: ["pipe", "pipe", "pipe"] }
  );
  // A closed pipe fails the writes; that is how the feed learns Wireshark stopped reading.
  child.stdin.on("error", () => {});
  const stderr: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text: string) => {
    stderr.push(text);
    if (stderr.length > 20) stderr.shift();
  });
  const exited = new Promise<number | null>((resolve) => {
    child.once("error", (error) => {
      stderr.push(error.message);
      resolve(null);
    });
    child.once("close", (code) => resolve(code));
  });
  const opened = new Promise<boolean>((resolve) => {
    let seen = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      if (seen.length < 64) seen += text;
      if (seen.includes("open\n")) resolve(true);
    });
    void exited.then(() => resolve(false));
  });
  const failure = (code: number | null) =>
    new Error(stderr.join("").trim() || `${options.runtime} exec into the Wireshark container ended (exit ${code ?? "error"})`);
  return { child, exited, opened, failure };
}

/**
 * Writes one capture into the pipe: waits until Wireshark opens it, then
 * pipes the capture into it until Wireshark closes the pipe (resolves), the
 * capture ends (resolves, or rejects with its error) or `signal` aborts.
 */
async function feedOnce(options: CapturePipeOptions, signal: AbortSignal): Promise<void> {
  const exec = execIntoPipe(options);
  const kill = () => exec.child.kill("SIGTERM");
  signal.addEventListener("abort", kill, { once: true });
  try {
    if (!(await exec.opened)) {
      if (signal.aborted) return;
      throw exec.failure(await exec.exited);
    }
    // The capture ends with the session, or when Wireshark closes the pipe.
    const capture = new AbortController();
    const stopCapture = () => capture.abort();
    signal.addEventListener("abort", stopCapture, { once: true });
    void exec.exited.then(stopCapture);
    try {
      const stream = await options.open(capture.signal);
      let reading = true;
      for await (const chunk of stream) {
        // After a stop the capture still ends with its last blocks; nobody reads them then.
        if (reading && !(await write(exec.child.stdin, chunk))) {
          reading = false;
          stopCapture();
        }
      }
    } catch (error) {
      // A capture that could not start because it was stopped already did not fail.
      if (!capture.signal.aborted) throw error;
    } finally {
      signal.removeEventListener("abort", stopCapture);
    }
    // The capture ended by itself: Wireshark reads the end of the stream.
    exec.child.stdin.end();
    await exec.exited;
  } finally {
    signal.removeEventListener("abort", kill);
    if (exec.child.exitCode === null && exec.child.signalCode === null) kill();
  }
}

/**
 * Feeds the session's capture into its Wireshark's pipe until `stop()`. A
 * capture runs each time Wireshark opens the pipe: when it starts, and when
 * its capture is restarted in Wireshark.
 */
export function feedCapturePipe(options: CapturePipeOptions): CapturePipeFeed {
  const stopped = new AbortController();
  const isStopped = () => stopped.signal.aborted;
  const retryDelay = options.retryDelayMs ?? RETRY_DELAY_MS;
  const done = (async (): Promise<Error | undefined> => {
    while (!isStopped()) {
      const started = Date.now();
      try {
        await feedOnce(options, stopped.signal);
      } catch (error) {
        if (isStopped()) return undefined;
        return error instanceof Error ? error : new Error(String(error));
      }
      await sleep(Math.max(0, retryDelay - (Date.now() - started)), stopped.signal);
    }
    return undefined;
  })();
  return { done, stop: () => stopped.abort() };
}
