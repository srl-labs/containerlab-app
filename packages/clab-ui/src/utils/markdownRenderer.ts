/**
 * Markdown renderer utility for React TopoViewer
 * Uses markdown-it with syntax highlighting and emoji support
 */
import MarkdownIt from "markdown-it";
import { full as markdownItEmoji } from "markdown-it-emoji";
import hljs from "highlight.js";
import DOMPurify from "dompurify";

const ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

const ESCAPE_REGEX = /[&<>"']/g;

/**
 * Escape HTML entities for safe display
 */
function escapeHtml(text: string): string {
  return text.replace(ESCAPE_REGEX, (char) => ESCAPE_MAP[char] || char);
}

/**
 * Configured markdown-it instance with:
 * - Syntax highlighting via highlight.js
 * - Emoji support via markdown-it-emoji
 * - Security: HTML disabled, linkify enabled
 */
const markdownRenderer = new MarkdownIt({
  html: false, // Disable raw HTML for security
  linkify: true, // Auto-convert URLs to links
  typographer: true, // Smart quotes and dashes
  // Annotations are edited in a plain textarea, so a typed newline must stay a
  // line break after rendering (GitHub-comment style), or the committed result
  // won't match what the editor showed.
  breaks: true,
  langPrefix: "hljs language-",
  highlight(code: string, lang: string): string {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return escapeHtml(code);
    }
  }
}).use(markdownItEmoji);

// Match: </a></p> + any whitespace + <p><a (with or without space before href)
const BADGE_PARAGRAPH_REGEX = /<\/a><\/p>\s*<p><a(?=\s|>)/g;
// <li><p>content</p></li> -> <li>content</li>
const LIST_ITEM_OPEN_REGEX = /<li>\s*<p>/g;
const LIST_ITEM_CLOSE_REGEX = /<\/p>\s*<\/li>/g;
const LIST_ITEM_REGEX = /<li>([\s\S]*?)<\/li>/g;
const PARAGRAPH_BREAK_REGEX = /<\/p>\s*<p>/g;

/**
 * Post-process HTML to fix common markdown rendering issues
 * - Merges consecutive badge/image paragraphs into single line (like GitHub)
 * - Removes paragraph wrappers inside list items (fixes bullet alignment)
 */
function postProcessHtml(html: string): string {
  let result = html;

  // 1. Merge consecutive paragraphs containing only image links (badges)
  result = result.replace(BADGE_PARAGRAPH_REGEX, "</a> <a");

  // 2. Remove <p> tags wrapping list item content to fix bullet alignment
  result = result.replace(LIST_ITEM_OPEN_REGEX, "<li>");
  result = result.replace(LIST_ITEM_CLOSE_REGEX, "</li>");

  // 3. For list items with multiple paragraphs, replace intermediate </p><p> with <br>
  result = result.replace(LIST_ITEM_REGEX, (match) => {
    return match.replace(PARAGRAPH_BREAK_REGEX, "<br>");
  });

  return result;
}

/**
 * Render markdown text to sanitized HTML
 * @param text - Raw markdown text
 * @returns Sanitized HTML string
 */
export function renderMarkdown(text: string): string {
  if (text.trim().length === 0) {
    return "";
  }
  const rendered = markdownRenderer.render(text);
  const processed = postProcessHtml(rendered);
  return DOMPurify.sanitize(processed);
}
