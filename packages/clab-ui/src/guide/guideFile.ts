/** Where a topology's lab guide lives: `mylab.clab.yml` → `mylab.clab.md`, in the same directory. */

const TOPOLOGY_SUFFIX = /\.clab\.(?:ya?ml|gotmpl)$/i;

export const GUIDE_FILE_SUFFIX = ".clab.md";

/** The guide's file name or path for a topology's; undefined for anything that is not a topology. */
export function guideFileNameFor(topologyFileName: string): string | undefined {
  if (!TOPOLOGY_SUFFIX.test(topologyFileName)) return undefined;
  return topologyFileName.replace(TOPOLOGY_SUFFIX, GUIDE_FILE_SUFFIX);
}
