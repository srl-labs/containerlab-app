import type { LabHostScriptEvent, LabHostScriptResult } from "@containerlab/clab-ui/host";

import { LabBackendError } from "./errors.ts";

/** Keeps the tail of each stream so a chatty script cannot flood the UI. */
const MAX_OUTPUT_CHARS = 512 * 1024;

class OutputTail {
  private text = "";
  private truncated = false;

  add(chunk: string): void {
    this.text += chunk;
    // Cut only now and then: slicing on every chunk would copy the tail each time.
    if (this.text.length > 2 * MAX_OUTPUT_CHARS) {
      this.text = this.text.slice(-MAX_OUTPUT_CHARS);
      this.truncated = true;
    }
  }

  read(): string {
    const truncated = this.truncated || this.text.length > MAX_OUTPUT_CHARS;
    if (!truncated) return this.text;
    return `[output truncated to the last ${MAX_OUTPUT_CHARS} characters]\n${this.text.slice(-MAX_OUTPUT_CHARS)}`;
  }
}

/** Runs a stream of script events to its end and keeps the output's tail. */
export async function collectHostScript(
  events: AsyncIterable<LabHostScriptEvent>
): Promise<LabHostScriptResult> {
  const stdout = new OutputTail();
  const stderr = new OutputTail();
  for await (const event of events) {
    if (event.type === "output") {
      (event.stream === "stderr" ? stderr : stdout).add(event.text);
      continue;
    }
    return { ...event.result, stdout: stdout.read(), stderr: stderr.read() };
  }
  throw new LabBackendError("The script ended without an exit status.", 500);
}
