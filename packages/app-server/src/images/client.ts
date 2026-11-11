import type { ImagesConfig } from "./config.ts";
import { ImagesError, statusForClimgCode } from "./errors.ts";
import type { Redactor } from "./redact.ts";
import { runClimg, type RunResult } from "./runner.ts";
import { isObjectValue } from "./shapes.ts";

const STDERR_TAIL = 600;

export function tail(text: string, length = STDERR_TAIL): string {
  const trimmed = text.trim();
  return trimmed.length > length ? `…${trimmed.slice(-length)}` : trimmed;
}

/** Runs short `climg` commands and returns their single JSON document. */
export class ClimgClient {
  constructor(
    readonly config: ImagesConfig,
    readonly redactor: Redactor
  ) {}

  async raw(args: string[], timeoutMs?: number): Promise<RunResult> {
    try {
      return await runClimg(this.config, args, timeoutMs);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new ImagesError(`Cannot run climg: ${this.redactor.text(reason)}`, 503, "spawn_failed");
    }
  }

  /**
   * `allowExit1`: `climg doctor` prints its document and exits 1 when a check fails.
   * A `{"error": …}` envelope always throws, with the HTTP status of its code.
   */
  async json(args: string[], options: { timeoutMs?: number; allowExit1?: boolean } = {}): Promise<unknown> {
    const result = await this.raw(args, options.timeoutMs);
    if (result.timedOut) throw new ImagesError("climg did not finish in time", 504, "timeout");
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      const detail = this.redactor.text(tail(result.stderr));
      throw new ImagesError(
        `climg failed${result.code === null ? "" : ` (exit ${result.code})`}${detail ? `: ${detail}` : ""}`,
        500,
        "climg_failed"
      );
    }
    if (isObjectValue(parsed) && isObjectValue(parsed.error)) {
      const code = typeof parsed.error.code === "string" ? parsed.error.code : "error";
      const message = typeof parsed.error.message === "string" ? parsed.error.message : "climg failed";
      throw new ImagesError(this.redactor.text(message), statusForClimgCode(code), code);
    }
    if (result.code !== 0 && !(options.allowExit1 === true && result.code === 1)) {
      throw new ImagesError(`climg failed (exit ${result.code})`, 500, "climg_failed");
    }
    return parsed;
  }
}
