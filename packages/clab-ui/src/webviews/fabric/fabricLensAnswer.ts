/** A lens's answer, asked again when the fabric changes while the view is live. */
import { useFabric } from "./fabricContext";
import { isFabricChange, useFabricAnswer, useLiveRevision, type FabricAnswerState } from "./fabricData";
import type { FabricTableAnswer } from "./fabricTypes";

export function useLensAnswer<TRecord>(
  name: string,
  args: Readonly<Record<string, string>>,
  ready: boolean
): FabricAnswerState<FabricTableAnswer<TRecord>> {
  const { client, at, subscribeLive } = useFabric();
  const revision = useLiveRevision(subscribeLive, isFabricChange);
  return useFabricAnswer<FabricTableAnswer<TRecord>>(
    client,
    ready ? {
      method: "GET",
      path: `lenses/${name}`,
      query: { ...args, at: at === undefined ? undefined : String(at), table: "1" }
    } : undefined,
    revision
  );
}
