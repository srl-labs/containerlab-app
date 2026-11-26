/** A first lab guide for a topology: a working example, with its own nodes, to write over. */
import { DEFAULT_EXEC_COMMANDS_BY_KIND } from "../core/constants/nodeKindDefaults";

/** A node of the lab, with the kind that decides what its shell understands. */
export interface GuideTemplateNode {
  name: string;
  kind?: string;
}

const GUIDE_DOCS_URL = "https://srl-labs.github.io/containerlab-app/docs/guides/lab-guides/";

function fence(info: string, code: string): string {
  return ["```" + info, code, "```"].join("\n");
}

/**
 * A terminal block types into the shell Attach Shell opens: the CLI of a
 * network OS for the kinds that have one, a Linux shell for the others. The
 * lines are ones each of them knows, down to a BusyBox shell.
 */
function terminalExample(node: GuideTemplateNode): string {
  const opensCli = node.kind !== undefined && Object.hasOwn(DEFAULT_EXEC_COMMANDS_BY_KIND, node.kind);
  return opensCli ? fence(`text terminal=${node.name}`, "show version") : fence(`sh terminal=${node.name}`, "hostname\nip addr");
}

export function guideTemplate(labName: string, nodes: readonly GuideTemplateNode[]): string {
  const title = labName.trim() === "" ? "Lab guide" : labName.trim();
  const first = nodes.at(0);
  const second = nodes.at(1) ?? first;
  const header = ["---", `title: ${JSON.stringify(title)}`, "duration: 15m", "---", ""];
  const intro = [
    "Say what this lab is about and what the reader will do in it.",
    "",
    "Each `##` heading starts a step. A code block can run its command on nodes",
    "with `exec=`, or type its lines into a node's shell with `terminal=`.",
    `More in the [lab guide documentation](${GUIDE_DOCS_URL}).`,
    ""
  ];
  if (first === undefined || second === undefined) {
    return [
      ...header,
      ...intro,
      "## First step",
      "",
      "Add nodes to the topology, then run commands on them from here.",
      "",
      fence("sh", "containerlab inspect"),
      ""
    ].join("\n");
  }
  return [
    ...header,
    ...intro,
    "## Look around",
    "",
    `Check that [${first.name}](node:${first.name}) is up:`,
    "",
    fence(`sh exec=${first.name}`, "uname -a"),
    "",
    "## Work on a node",
    "",
    `Open a shell on [${second.name}](node:${second.name}) and type into it:`,
    "",
    terminalExample(second),
    ""
  ].join("\n");
}
