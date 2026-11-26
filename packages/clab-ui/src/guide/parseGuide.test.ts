import assert from "node:assert/strict";
import test from "node:test";

import { guideCodeBlocks, parseGuide, type GuideCodeBlock } from "./parseGuide";

const GUIDE = `---
title: Two SR Linux routers, one link
duration: 15m
---

Bring up the link between [srl1](node:srl1) and [srl2](node:srl2).

## Meet the routers

Ask each one for its version:

\`\`\`sh exec=srl1,srl2
sr_cli "show version"
\`\`\`

## Configure the link

\`\`\`srl terminal=srl1
enter candidate
commit now
\`\`\`

## Ping across

\`\`\`sh exec=srl1
ip netns exec srbase-default ping -c 3 192.168.0.2
\`\`\`
`;

function codeBlock(source: string): GuideCodeBlock {
  const block = guideCodeBlocks(parseGuide(source)).at(0);
  assert.ok(block, "expected a code block");
  return block;
}

test("front matter names the guide and steps follow the ## headings", () => {
  const guide = parseGuide(GUIDE);
  assert.equal(guide.title, "Two SR Linux routers, one link");
  assert.equal(guide.duration, "15m");
  assert.deepEqual(guide.intro, [
    { type: "markdown", text: "Bring up the link between [srl1](node:srl1) and [srl2](node:srl2)." }
  ]);
  assert.deepEqual(
    guide.steps.map((step) => step.title),
    ["Meet the routers", "Configure the link", "Ping across"]
  );
  assert.deepEqual(
    guide.steps[0].parts.map((part) => part.type),
    ["markdown", "code"]
  );
});

test("fence attributes say where a block runs", () => {
  const blocks = guideCodeBlocks(parseGuide(GUIDE));
  assert.deepEqual(
    blocks.map(({ lang, kind, nodes }) => ({ lang, kind, nodes })),
    [
      { lang: "sh", kind: "exec", nodes: ["srl1", "srl2"] },
      { lang: "srl", kind: "terminal", nodes: ["srl1"] },
      { lang: "sh", kind: "exec", nodes: ["srl1"] }
    ]
  );
  assert.equal(blocks[0].command, 'sr_cli "show version"');
  assert.equal(blocks[1].code, "enter candidate\ncommit now");
  assert.equal(blocks[1].command, undefined);
});

test("a fence without a known attribute is a copy block", () => {
  for (const info of ["sh", "", "sh title=\"Show it\"", "sh exec=", "sh exec=, ,"]) {
    const block = codeBlock(`\`\`\`${info}\nls -l\n\`\`\`\n`);
    assert.equal(block.kind, "copy", info);
    assert.deepEqual(block.nodes, [], info);
  }
});

test("attribute values may be quoted and repeat node names once", () => {
  assert.deepEqual(codeBlock('```sh exec="srl1, srl2,srl1"\nuptime\n```').nodes, ["srl1", "srl2"]);
  assert.deepEqual(codeBlock("```sh title='x y' terminal='leaf-1'\nshow\n```").nodes, ["leaf-1"]);
});

test("an exec block runs one command, continued lines included", () => {
  const continued = codeBlock("```sh exec=srl1\nping -c 3 \\\n  192.168.0.2\n\n```");
  assert.equal(continued.command, "ping -c 3 192.168.0.2");
  const several = codeBlock("```sh exec=srl1\nuptime\nhostname\n```");
  assert.equal(several.command, undefined);
});

test("headings inside a fence stay code", () => {
  const guide = parseGuide("## One\n\n```sh\n## not a step\n```\n\n## Two\n");
  assert.deepEqual(guide.steps.map((step) => step.title), ["One", "Two"]);
  assert.equal(guideCodeBlocks(guide)[0].code, "## not a step");
});

test("tilde fences and longer fences close on their own marker", () => {
  const guide = parseGuide("~~~sh exec=a\nuptime\n```\n~~~\n\n````md\n```sh\ninner\n```\n````\n");
  const blocks = guideCodeBlocks(guide);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].code, "uptime\n```");
  assert.equal(blocks[1].code, "```sh\ninner\n```");
});

test("a fence in a list item drops its own indentation from the code", () => {
  const block = codeBlock("1. Configure:\n\n   ```srl terminal=srl1\n   enter candidate\n     set / interface ethernet-1/1\n  commit now\n   ```\n");
  assert.equal(block.code, "enter candidate\n  set / interface ethernet-1/1\ncommit now");
});

test("a fence indented as far as its list item's text is still a block", () => {
  const fenced = (indent: string) => `${indent}\`\`\`srl terminal=srl1\n${indent}enter candidate\n${indent}  commit now\n${indent}\`\`\``;
  for (const [item, indent] of [
    ["- Configure:", "    "],
    ["1. Configure:", "    "],
    ["10. Configure:", "      "],
    ["- Configure:", "\t"]
  ]) {
    const guide = parseGuide(`${item}\n\n${fenced(indent)}\n\n- Then check.`);
    const block = guideCodeBlocks(guide).at(0);
    assert.ok(block, `expected a block under "${item}" indented by ${JSON.stringify(indent)}`);
    assert.equal(block.kind, "terminal");
    assert.equal(block.code, "enter candidate\n  commit now");
    assert.deepEqual(
      guide.intro.map((part) => part.type),
      ["markdown", "code", "markdown"]
    );
  }
});

test("a fence in a nested list item is a block, and the list ends with its indentation", () => {
  const nested = "- Outer\n  - Inner:\n\n      ```sh exec=r1\n      uptime\n      ```\n";
  assert.equal(codeBlock(nested).command, "uptime");
  // Back at the margin the list is over: four spaces make an indented code block again.
  const after = "- Item\n\nPlain text.\n\n    ```sh exec=r1\n    uptime\n    ```\n";
  assert.deepEqual(guideCodeBlocks(parseGuide(after)), []);
});

test("a fence indented four spaces outside a list stays text", () => {
  const guide = parseGuide("Indented code:\n\n    ```sh exec=r1\n    uptime\n    ```\n");
  assert.deepEqual(guideCodeBlocks(guide), []);
  assert.equal(guide.intro.length, 1);
});

test("link reference definitions count for the whole guide", () => {
  const guide = parseGuide(
    "See the [docs][clab].\n\n## One\n\nMore in the [docs][clab] and on [srl1][n1].\n\n## Links\n\n[clab]: https://containerlab.dev \"Containerlab\"\n[n1]: node:srl1\n"
  );
  assert.equal(guide.references, '[clab]: https://containerlab.dev "Containerlab"\n[n1]: node:srl1');
  assert.deepEqual(guide.intro, [{ type: "markdown", text: "See the [docs][clab]." }]);
  // A step holding only definitions has nothing left to show.
  assert.deepEqual(guide.steps.map((step) => step.parts.length), [1, 0]);
  assert.equal(parseGuide("Just text with [a link](https://example.com).").references, "");
});

test("an unclosed fence runs to the end of the guide", () => {
  assert.equal(codeBlock("```sh\nuptime\n## Later").code, "uptime\n## Later");
});

test("without front matter, the first top heading names the guide", () => {
  const guide = parseGuide("# BGP lab\n\nIntro text.\n\n## Step\n\n# Not a title\n");
  assert.equal(guide.title, "BGP lab");
  assert.deepEqual(guide.intro, [{ type: "markdown", text: "Intro text." }]);
  assert.deepEqual(guide.steps[0].parts, [{ type: "markdown", text: "# Not a title" }]);
});

test("front matter that is not YAML leaves the rest of the guide", () => {
  const guide = parseGuide("---\ntitle: [unclosed\n---\n## Step\n");
  assert.equal(guide.title, undefined);
  assert.deepEqual(guide.steps.map((step) => step.title), ["Step"]);
});

test("block ids follow the block, not its place in the guide", () => {
  const before = guideCodeBlocks(parseGuide(GUIDE));
  const edited = guideCodeBlocks(parseGuide(GUIDE.replace("Ask each one", "First, ask each one")));
  assert.deepEqual(edited.map((block) => block.id), before.map((block) => block.id));

  // The same block twice gets two ids.
  const twice = guideCodeBlocks(parseGuide("```sh exec=a\nuptime\n```\n\n```sh exec=a\nuptime\n```\n"));
  assert.equal(new Set(twice.map((block) => block.id)).size, 2);
});

test("a guide with only text has no steps", () => {
  const guide = parseGuide("Just some notes.\n");
  assert.deepEqual(guide.steps, []);
  assert.deepEqual(guide.intro, [{ type: "markdown", text: "Just some notes." }]);
});

test("Windows line endings and a byte order mark read the same", () => {
  const guide = parseGuide(`﻿${GUIDE.replace(/\n/g, "\r\n")}`);
  assert.equal(guide.title, "Two SR Linux routers, one link");
  assert.equal(guideCodeBlocks(guide)[1].code, "enter candidate\ncommit now");
});
