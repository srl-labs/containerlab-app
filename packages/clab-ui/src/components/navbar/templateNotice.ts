// What to tell the user about a topology template on the canvas.
import type { TopologyTemplateState } from "../../core/types/messages";

/** Why the canvas does not show the template as containerlab deploys it; undefined when it does. */
export function templateProblem(
  template: TopologyTemplateState,
  fileName: string
): string | undefined {
  const { error } = template;
  if (!error) return undefined;
  if (template.source === "last-rendered") {
    return `${fileName} no longer renders, so the canvas keeps its last rendering: ${error}`;
  }
  if (template.source === "text") {
    return `containerlab could not render ${fileName}, so the canvas shows it as written: ${error}`;
  }
  return `containerlab rejects the topology ${fileName} renders to: ${error}`;
}
