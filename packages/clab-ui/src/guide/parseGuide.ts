/**
 * Lab guides: Markdown beside a topology whose code blocks run on its nodes.
 *
 * - Front matter (`---` … `---` at the top) may set `title` and `duration`.
 * - Each `##` heading starts a step; what comes before the first is the introduction.
 * - A code fence's info string names what its button does after the language:
 *   `exec=srl1,srl2` runs the command on those nodes, `terminal=srl1` types the
 *   lines into the node's terminal, and no attribute leaves it to Copy.
 *   Other attributes are ignored, so other Markdown renderers show plain code.
 */
import * as YAML from "yaml";

import { isRecord } from "../core/utilities/typeHelpers";

type GuideBlockKind = "copy" | "exec" | "terminal";

export interface GuideCodeBlock {
  type: "code";
  /** Stable while the block's kind, nodes and code stay the same, so its checkmark survives edits around it. */
  id: string;
  lang: string;
  kind: GuideBlockKind;
  /** The nodes `exec` runs on or `terminal` types into; empty for copy blocks. */
  nodes: string[];
  code: string;
  /**
   * The one command an exec block runs, with `\` continuations joined.
   * Undefined when the block holds several commands, which exec cannot run.
   */
  command?: string;
}

interface GuideMarkdown {
  type: "markdown";
  text: string;
}

export type GuidePart = GuideMarkdown | GuideCodeBlock;

interface GuideStep {
  title: string;
  parts: GuidePart[];
}

export interface ParsedGuide {
  title?: string;
  duration?: string;
  intro: GuidePart[];
  steps: GuideStep[];
}

const FRONT_MATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const STEP_HEADING = /^ {0,3}##[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const TITLE_HEADING = /^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
// A word of the info string; quotes keep spaces in it.
const INFO_WORD = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;
const ATTRIBUTE = /^([\w-]+)=(.*)$/s;

interface FrontMatter {
  title?: string;
  duration?: string;
  body: string;
}

function readFrontMatter(source: string): FrontMatter {
  const match = FRONT_MATTER.exec(source);
  if (!match) return { body: source };
  const body = source.slice(match[0].length);
  let data: unknown;
  try {
    data = YAML.parse(match[1]);
  } catch {
    // Front matter that is not YAML is left out, and the guide still reads.
    return { body };
  }
  if (!isRecord(data)) return { body };
  const text = (value: unknown): string | undefined => {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number") return String(value);
    return undefined;
  };
  return { title: text(data.title), duration: text(data.duration), body };
}

function unquote(value: string): string {
  return value.replace(/"([^"]*)"|'([^']*)'/g, "$1$2");
}

function parseInfo(info: string): { lang: string; attrs: Map<string, string> } {
  const attrs = new Map<string, string>();
  let lang = "";
  for (const [word] of info.matchAll(INFO_WORD)) {
    const attribute = ATTRIBUTE.exec(word);
    if (attribute) {
      // The first of a repeated attribute counts.
      if (!attrs.has(attribute[1])) attrs.set(attribute[1], unquote(attribute[2]));
    } else if (lang === "") {
      lang = unquote(word);
    }
  }
  return { lang, attrs };
}

function nodeList(value: string): string[] {
  return [...new Set(value.split(",").map((name) => name.trim()).filter((name) => name !== ""))];
}

/** The one command of an exec block: `\` at a line's end continues it on the next. */
function singleCommand(code: string): string | undefined {
  const commands = code
    .replace(/[ \t]*\\\r?\n[ \t]*/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return commands.length === 1 ? commands[0] : undefined;
}

function blockKind(attrs: Map<string, string>): { kind: GuideBlockKind; nodes: string[] } {
  for (const [key, value] of attrs) {
    if (key !== "exec" && key !== "terminal") continue;
    const nodes = nodeList(value);
    if (nodes.length > 0) return { kind: key, nodes };
  }
  return { kind: "copy", nodes: [] };
}

/** FNV-1a, enough to tell blocks of one guide apart. */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function codeBlock(info: string, code: string, seen: Map<string, number>): GuideCodeBlock {
  const { lang, attrs } = parseInfo(info);
  const { kind, nodes } = blockKind(attrs);
  const key = hashText(`${kind}\n${nodes.join(",")}\n${code}`);
  const occurrence = (seen.get(key) ?? 0) + 1;
  seen.set(key, occurrence);
  const command = kind === "exec" ? singleCommand(code) : undefined;
  return { type: "code", id: `${key}-${occurrence}`, lang, kind, nodes, code, command };
}

/**
 * A code line without the indentation of its fence, as in a list item: up to
 * that many leading spaces go, and the code keeps any deeper indentation.
 */
function unindent(line: string, indent: number): string {
  let start = 0;
  while (start < indent && line[start] === " ") start += 1;
  return line.slice(start);
}

/** The index of a fence's closing line, or the end of the file without one. */
function closingFence(lines: readonly string[], start: number, marker: string): number {
  const closing = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
  const index = lines.findIndex((line, position) => position >= start && closing.test(line));
  return index < 0 ? lines.length : index;
}

export function parseGuide(source: string): ParsedGuide {
  const front = readFrontMatter(source.replace(/^\uFEFF/, ""));
  let title = front.title;
  const intro: GuidePart[] = [];
  const steps: GuideStep[] = [];
  const seen = new Map<string, number>();
  let text: string[] = [];
  const parts = () => steps.at(-1)?.parts ?? intro;
  const flushText = () => {
    const markdown = text.join("\n").trim();
    text = [];
    if (markdown !== "") parts().push({ type: "markdown", text: markdown });
  };

  const lines = front.body.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = FENCE_OPEN.exec(line);
    const step = STEP_HEADING.exec(line);
    const heading = TITLE_HEADING.exec(line);
    // A backtick fence's info string has no backticks.
    if (fence && !(fence[2][0] === "`" && fence[3].includes("`"))) {
      const [, indent, marker, info] = fence;
      const end = closingFence(lines, index + 1, marker);
      flushText();
      const code = lines.slice(index + 1, end).map((codeLine) => unindent(codeLine, indent.length));
      parts().push(codeBlock(info.trim(), code.join("\n"), seen));
      index = end;
    } else if (step) {
      flushText();
      steps.push({ title: step[1], parts: [] });
    } else if (heading && title === undefined && steps.length === 0) {
      // Without a title in the front matter, the first top heading names the guide.
      flushText();
      title = heading[1];
    } else {
      text.push(line);
    }
  }
  flushText();
  return { title, duration: front.duration, intro, steps };
}

/** Every code block of the guide, introduction first. */
export function guideCodeBlocks(guide: ParsedGuide): GuideCodeBlock[] {
  return [guide.intro, ...guide.steps.map((step) => step.parts)]
    .flat()
    .filter((part): part is GuideCodeBlock => part.type === "code");
}
