/**
 * The releases a c9s lab host needs. containerlab-app has no compatibility
 * path for older ones; detection names the version to install instead.
 */

/** The first containerlab release with the c9s inspect fields, `logs` and namespaced events. */
export const C9S_MIN_CONTAINERLAB_VERSION = "0.83.0";

/** The first clabernetes release with the client capture interface and node run state. */
export const C9S_MIN_CLABERNETES_VERSION = "0.11.0";

/** Version of a development build, which is taken to have everything. */
const DEV_BUILD_VERSION = "0.0.0";

function parts(version: string): number[] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/**
 * Whether `version` is at least `minimum`. Development builds (`0.0.0`, and
 * tags that are not versions, such as `dev` or a commit) pass.
 */
export function meetsMinimumVersion(version: string, minimum: string): boolean {
  const actual = parts(version);
  const required = parts(minimum);
  if (!actual || version.trim().replace(/^v/, "").startsWith(DEV_BUILD_VERSION)) return true;
  if (!required) return true;
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== required[index]) return actual[index] > required[index];
  }
  return true;
}
