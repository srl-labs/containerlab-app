// Group an apply plan into the sections the plan dialog lists.
import type { ApplyPlan } from "../../../host/applyPlan";

type ApplyPlanSectionId =
  | "addedNodes"
  | "startedNodes"
  | "restartedNodes"
  | "recreatedNodes"
  | "deletedNodes"
  | "addedLinks"
  | "deletedEndpoints";

type ApplyPlanTone = "success" | "info" | "warning" | "error";

interface ApplyPlanItem {
  label: string;
  /** Why containerlab touches the node, when it says. */
  reason?: string;
}

export interface ApplyPlanSection {
  id: ApplyPlanSectionId;
  title: string;
  description: string;
  tone: ApplyPlanTone;
  items: ApplyPlanItem[];
}

interface SectionSpec {
  id: ApplyPlanSectionId;
  title: string;
  description: string;
  tone: ApplyPlanTone;
}

/** Additions first, then changes to running nodes by impact, then links. */
const SECTION_SPECS: readonly SectionSpec[] = [
  {
    id: "addedNodes",
    title: "Create",
    description: "New nodes are deployed.",
    tone: "success"
  },
  {
    id: "startedNodes",
    title: "Start",
    description: "Stopped nodes are started.",
    tone: "success"
  },
  {
    id: "restartedNodes",
    title: "Restart",
    description: "The container restarts and keeps its filesystem.",
    tone: "info"
  },
  {
    id: "recreatedNodes",
    title: "Recreate",
    description: "The container is removed and created again.",
    tone: "warning"
  },
  {
    id: "deletedNodes",
    title: "Remove",
    description: "Nodes no longer in the topology are removed.",
    tone: "error"
  },
  {
    id: "addedLinks",
    title: "Connect links",
    description: "New links are wired between running nodes.",
    tone: "success"
  },
  {
    id: "deletedEndpoints",
    title: "Disconnect link ends",
    description: "Interfaces of removed links are deleted.",
    tone: "error"
  }
];

/** containerlab joins link ends with " -- ". */
function formatLink(link: string): string {
  return link.split(" -- ").join("  ↔  ");
}

export function buildApplyPlanSections(plan: ApplyPlan): ApplyPlanSection[] {
  const sections: ApplyPlanSection[] = [];
  for (const spec of SECTION_SPECS) {
    const values = plan[spec.id];
    if (values.length === 0) continue;
    const isLinkSection = spec.id === "addedLinks";
    const items = values.map((value): ApplyPlanItem => {
      const reason = isLinkSection ? undefined : plan.nodeChangeReasons[value];
      return reason !== undefined
        ? { label: value, reason }
        : { label: isLinkSection ? formatLink(value) : value };
    });
    sections.push({ ...spec, items });
  }
  return sections;
}

/** Recreated and removed nodes lose whatever was changed inside them at runtime. */
export function applyPlanLosesState(plan: ApplyPlan): boolean {
  return plan.recreatedNodes.length > 0 || plan.deletedNodes.length > 0;
}

export function applyPlanChangeCount(plan: ApplyPlan): number {
  return SECTION_SPECS.reduce((count, spec) => count + plan[spec.id].length, 0);
}
