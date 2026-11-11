import fs from "node:fs";

const REDACTED = "<redacted>";
const MIN_SECRET_LENGTH = 3;

/**
 * The lab password string, read from the `climg` config file, removed from
 * everything the Images routes return. `climg` redacts too; this is the second line.
 */
export class Redactor {
  private secrets = new Set<string>();

  /** Reads `credentials.password` from a `climg` YAML config with a line scan (no YAML dependency). */
  loadFromConfigFile(file: string | undefined): void {
    if (!file) return;
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return;
    }
    let inCredentials = false;
    for (const line of text.split(/\r?\n/)) {
      if (/^credentials\s*:/.test(line)) {
        inCredentials = true;
        continue;
      }
      if (inCredentials && /^\S/.test(line) && line.trim() !== "") inCredentials = false;
      const match = inCredentials ? /^\s+password\s*:\s*(.*?)\s*$/.exec(line) : null;
      if (match) this.add(stripQuotes(match[1]));
    }
  }

  add(secret: string): void {
    if (secret.length >= MIN_SECRET_LENGTH) this.secrets.add(secret);
  }

  text(value: string): string {
    let result = value;
    for (const secret of this.secrets) result = result.split(secret).join(REDACTED);
    return result;
  }

  /** A copy of any JSON value with every string passed through `text`. */
  deep<T>(value: T): T {
    if (this.secrets.size === 0) return value;
    return this.walk(value) as T;
  }

  private walk(value: unknown): unknown {
    if (typeof value === "string") return this.text(value);
    if (Array.isArray(value)) return value.map((item) => this.walk(item));
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [this.text(key), this.walk(item)])
      );
    }
    return value;
  }
}

function stripQuotes(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
}
