import { RequestError } from "../runtimeProxy.ts";
import { IMAGE_EXTENSIONS } from "./config.ts";

// Allow patterns of design D6. None of them lets a value start with `-`, and every
// positional also comes after `--`, so a value can never be read as an option.
const REF = /^(labhub:|local:)?[A-Za-z0-9#][A-Za-z0-9._@#+-]{0,199}$/;
const DOCKER_REFERENCE =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::\d{1,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*(?::[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,250}$/;
const KIND = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const VENDOR = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,63}$/;
const KEYWORD = /^[A-Za-z0-9#][A-Za-z0-9._@#+:/-]{0,63}$/;
const TEMPLATE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+@#-]{0,127}$/;
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const MAX_KEYWORDS = 8;

export const SEARCH_SOURCES = ["labhub", "local", "all"] as const;
export const SEARCH_STATUSES = ["built", "cached", "available"] as const;

function invalid(label: string, value: unknown): RequestError {
  const shown = typeof value === "string" ? JSON.stringify(value.slice(0, 80)) : typeof value;
  return new RequestError(`Invalid ${label}: ${shown}`, 400);
}

function text(label: string, value: unknown, pattern: RegExp, extra?: RegExp): string {
  if (typeof value !== "string" || value.length > 255 || !(pattern.test(value) || extra?.test(value) === true)) {
    throw invalid(label, value);
  }
  return value;
}

/** A record: `labhub:<name>`, `local:<name>`, `#<id>`, or a docker image reference. */
export const validateRef = (value: unknown): string => text("reference", value, REF, DOCKER_REFERENCE);
export const validateVersion = (value: unknown): string => text("version", value, VERSION);
export const validateKind = (value: unknown): string => text("kind", value, KIND);
export const validateVendor = (value: unknown): string => text("vendor", value, VENDOR);
export function validateTag(value: unknown): string {
  const tag = text("tag", value, DOCKER_REFERENCE);
  if (tag.length > 255) throw invalid("tag", value);
  return tag;
}
export const validateTemplateName = (value: unknown): string => text("template name", value, TEMPLATE_NAME);
export const validateJobId = (value: unknown): string => text("job id", value, JOB_ID);

/** An image file name: no path part, no `..`, an image extension. */
export function validateImageFileName(value: unknown): string {
  const name = text("file name", value, FILE_NAME);
  if (name.includes("..")) throw invalid("file name", value);
  const lower = name.toLowerCase();
  if (!IMAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
    throw new RequestError(`Unsupported file type. Accepted extensions: ${IMAGE_EXTENSIONS.join(" ")}`, 400);
  }
  return name;
}

/** A file name given to a job; it must exist in the images folder, so the extension is not enforced here. */
export function validateFileName(value: unknown): string {
  const name = text("file name", value, FILE_NAME);
  if (name.includes("..")) throw invalid("file name", value);
  return name;
}

export function validateKeywords(value: unknown): string[] {
  if (value === undefined || value === "") return [];
  if (typeof value !== "string") throw invalid("search words", value);
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length > MAX_KEYWORDS) throw new RequestError(`At most ${MAX_KEYWORDS} search words`, 400);
  return words.map((word) => text("search word", word, KEYWORD));
}

export function validateEnum<T extends string>(label: string, value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) throw invalid(label, value);
  return value as T;
}
