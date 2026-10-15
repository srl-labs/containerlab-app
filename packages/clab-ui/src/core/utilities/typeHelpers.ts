/**
 * Shared type helper functions for safe value extraction
 */

/**
 * Safely get string value, returns undefined if not a string
 */
export function getString(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

/**
 * Runtime guard for plain objects.
 */
export function isRecord(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

/**
 * Safely get string value with empty string default.
 * Also converts numbers to strings for fields that may be stored as numbers.
 */
export function getStringOrEmpty(val: unknown): string {
  if (typeof val === "string") return val;
  if (typeof val === "number") return String(val);
  return "";
}

/**
 * Safely get number value
 */
export function getNumber(val: unknown): number | undefined {
  return typeof val === "number" ? val : undefined;
}

/**
 * Safely get boolean value
 */
export function getBoolean(val: unknown): boolean | undefined {
  return typeof val === "boolean" ? val : undefined;
}

/**
 * Safely get string array
 */
export function getStringArray(val: unknown): string[] | undefined {
  return Array.isArray(val) ? val.filter((v): v is string => typeof v === "string") : undefined;
}

/**
 * Safely get record (object) value with unknown values.
 */
export function getRecordUnknown(val: unknown): Record<string, unknown> | undefined {
  return isRecord(val) ? val : undefined;
}

/**
 * Safely get a record of scalar values (string, number, boolean), keeping each
 * value's type. A key without a value (YAML `KEY:`) reads as an empty string.
 */
export function getScalarRecord(
  val: unknown
): Record<string, string | number | boolean> | undefined {
  if (!isRecord(val)) return undefined;
  const result: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(val)) {
    if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
      result[key] = entry;
    } else if (entry === null) {
      result[key] = "";
    }
  }
  return result;
}
