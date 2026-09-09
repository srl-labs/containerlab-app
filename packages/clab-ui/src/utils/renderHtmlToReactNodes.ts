/**
 * Convert sanitized HTML (DOMPurify output) into React nodes without
 * dangerouslySetInnerHTML. Event-handler and style attributes are dropped.
 */
import React from "react";

function domNodeToReactNode(node: ChildNode, key: string): React.ReactNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (!(node instanceof Element)) {
    return null;
  }

  const props: Record<string, unknown> = { key };
  for (const attr of Array.from(node.attributes)) {
    if (attr.name === "class") {
      props.className = attr.value;
    } else if (attr.name !== "style" && !attr.name.startsWith("on")) {
      props[attr.name] = attr.value;
    }
  }

  const children = Array.from(node.childNodes)
    .map((child, index) => domNodeToReactNode(child, `${key}:${index}`))
    .filter((child): child is React.ReactNode => child !== null);

  return React.createElement(node.tagName.toLowerCase(), props, ...children);
}

export function renderHtmlToReactNodes(html: string): React.ReactNode {
  if (html.length === 0) {
    return null;
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!(root instanceof Element)) {
    return null;
  }

  return Array.from(root.childNodes)
    .map((child, index) => domNodeToReactNode(child, `root:${index}`))
    .filter((child): child is React.ReactNode => child !== null);
}
