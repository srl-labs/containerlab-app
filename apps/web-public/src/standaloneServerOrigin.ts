export function resolveStandaloneServerOrigin(
  location: Pick<Location, "origin"> = window.location
): string {
  return location.origin;
}

export function standaloneServerUrl(path: string): string {
  return new URL(path, resolveStandaloneServerOrigin()).toString();
}
