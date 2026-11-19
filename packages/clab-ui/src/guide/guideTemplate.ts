/** A first lab guide for a topology: a working example, with its own nodes, to write over. */

const GUIDE_DOCS_URL = "https://srl-labs.github.io/containerlab-app/docs/guides/lab-guides/";

function fence(info: string, code: string): string {
  return ["```" + info, code, "```"].join("\n");
}

export function guideTemplate(labName: string, nodeNames: readonly string[]): string {
  const title = labName.trim() === "" ? "Lab guide" : labName.trim();
  const first = nodeNames.at(0);
  const second = nodeNames.at(1) ?? first;
  const header = ["---", `title: ${JSON.stringify(title)}`, "duration: 15m", "---", ""];
  const intro = [
    "Say what this lab is about and what the reader will do in it.",
    "",
    "Each `##` heading starts a step. A code block can run its command on nodes",
    "with `exec=`, or type its lines into a node's shell with `terminal=`.",
    `More in the [lab guide documentation](${GUIDE_DOCS_URL}).`,
    ""
  ];
  if (first === undefined) {
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
    `Check that [${first}](node:${first}) is up:`,
    "",
    fence(`sh exec=${first}`, "uname -a"),
    "",
    "## Work on a node",
    "",
    `Open a shell on [${second}](node:${second}) and type into it:`,
    "",
    fence(`sh terminal=${second}`, "hostname\nip -br addr"),
    ""
  ].join("\n");
}
