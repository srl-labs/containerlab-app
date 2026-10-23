/**
 * An error with the HTTP status that describes it best, so hosts can report
 * a missing lab (404) or a conflicting edit (409) the same way for every backend.
 */
export class LabBackendError extends Error {
  readonly status: number;

  constructor(message: string, status: number, options?: ErrorOptions) {
    super(message, options);
    this.name = "LabBackendError";
    this.status = status;
  }
}

/** The HTTP status carried by an error, if any. */
export function errorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && status >= 400 && status <= 599 ? status : undefined;
}

export function isNotFoundError(error: unknown): boolean {
  if (errorStatus(error) === 404) {
    return true;
  }
  if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "ENOENT") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("(404)");
}
