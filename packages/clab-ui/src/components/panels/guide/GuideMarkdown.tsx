// Prose of a lab guide: Markdown whose `node:` links center the canvas on a node.
import React from "react";
import Box from "@mui/material/Box";

import { getLoadedMarkdownRenderer, loadMarkdownRenderer } from "../../../utils/markdownRendererLazy";
import { renderHtmlToReactNodes } from "../../../utils/renderHtmlToReactNodes";
import { useCanvasStore } from "../../../stores/canvasStore";
import { controlRadius } from "../../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../../theme/typography";

// The sanitizer drops unknown link schemes, so `node:` links travel as a hash.
const NODE_LINK = /\]\(\s*node:([^)\s]+)\s*\)/g;
// The same link as a reference definition: `[name]: node:srl1`.
const NODE_REFERENCE = /^( {0,3}\[[^\]]+\]:[ \t]*)node:(\S+)/gm;
const NODE_HASH = "#clab-node=";

function withNodeLinks(text: string): string {
  return text
    .replace(NODE_LINK, (_match, node: string) => `](${NODE_HASH}${encodeURIComponent(node)})`)
    .replace(NODE_REFERENCE, (_match, name: string, node: string) => `${name}${NODE_HASH}${encodeURIComponent(node)}`);
}

/**
 * `node:` links center the canvas on their node; web links open beside the
 * editor. Other links, such as to a file next to the guide, lead nowhere here:
 * followed, they would take the page away from the lab.
 */
function handleLinkClick(event: React.MouseEvent<HTMLElement>): void {
  if (!(event.target instanceof Element)) return;
  const href = event.target.closest("a")?.getAttribute("href");
  // A mail link opens the mail app and leaves the page where it is.
  if (href == null || /^mailto:/i.test(href)) return;
  event.preventDefault();
  if (href.startsWith(NODE_HASH)) {
    useCanvasStore.getState().requestFocusNode(decodeURIComponent(href.slice(NODE_HASH.length)), { select: false });
  } else if (/^https?:\/\//i.test(href)) {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

const MARKDOWN_SX = {
  fontSize: 13,
  lineHeight: 1.6,
  color: "text.primary",
  overflowWrap: "anywhere",
  "& > :first-of-type": { mt: 0 },
  "& > :last-child": { mb: 0 },
  "& p, & ul, & ol, & blockquote, & table, & pre": { my: 1 },
  "& h1, & h2, & h3, & h4": { fontSize: 14, fontWeight: 600, mt: 2, mb: 0.75 },
  "& ul, & ol": { pl: 2.5 },
  "& li + li": { mt: 0.25 },
  "& a": { color: "primary.main" },
  "& a[href^='#clab-node=']": {
    fontFamily: MONO_FONT_FAMILY,
    fontSize: "0.92em",
    textDecoration: "none",
    borderBottom: 1,
    borderColor: "primary.main",
    "&:hover": { bgcolor: "action.hover" }
  },
  "& code": {
    fontFamily: MONO_FONT_FAMILY,
    fontSize: "0.92em",
    px: 0.5,
    borderRadius: "4px",
    bgcolor: "action.hover"
  },
  "& pre": {
    p: 1,
    overflowX: "auto",
    borderRadius: controlRadius,
    border: 1,
    borderColor: "divider",
    "& code": { p: 0, bgcolor: "transparent" }
  },
  "& blockquote": { pl: 1.5, ml: 0, borderLeft: 3, borderColor: "divider", color: "text.secondary" },
  "& table": { borderCollapse: "collapse" },
  "& th, & td": { border: 1, borderColor: "divider", px: 1, py: 0.5 },
  "& img": { maxWidth: "100%" },
  "& hr": { border: 0, borderTop: 1, borderColor: "divider" }
} as const;

/**
 * `references` are the guide's link reference definitions: this text is one
 * part of the guide, and its `[text][name]` links may be defined in another.
 */
export const GuideMarkdown: React.FC<{ text: string; references?: string }> = ({ text, references = "" }) => {
  const [loaded, setLoaded] = React.useState(() => getLoadedMarkdownRenderer() !== null);
  React.useEffect(() => {
    if (!loaded) void loadMarkdownRenderer().then(() => setLoaded(true));
  }, [loaded]);
  const content = React.useMemo(() => {
    const renderMarkdown = loaded ? getLoadedMarkdownRenderer() : null;
    if (!renderMarkdown) return null;
    const source = references === "" ? text : `${text}\n\n${references}`;
    return renderHtmlToReactNodes(renderMarkdown(withNodeLinks(source), { document: true }));
  }, [loaded, references, text]);

  // Plain text until the renderer has loaded.
  return (
    <Box
      sx={content === null ? { ...MARKDOWN_SX, whiteSpace: "pre-wrap" } : MARKDOWN_SX}
      data-testid="guide-markdown"
      onClick={handleLinkClick}
    >
      {content ?? text}
    </Box>
  );
};
