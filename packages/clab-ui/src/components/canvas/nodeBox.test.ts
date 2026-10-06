import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NODE_BOX_LABEL_LINE_HEIGHT_PX,
  NODE_BOX_THEME_COLORS,
  fitNodeBoxLabel,
  getNodeBoxFillCss,
  getNodeBoxMetrics,
  getNodeConnectionRect,
  parseNodeBoxSpacing,
  parseNodeStyle,
  resolveNodeBoxPaint,
  splitNodeBoxLabel,
  truncateNodeBoxLabel
} from "./nodeBox";

const measureByChars = (text: string) => Array.from(text).length * 10;

describe("node box", () => {
  it("parses only known node styles", () => {
    assert.equal(parseNodeStyle("boxed"), "boxed");
    assert.equal(parseNodeStyle("icon"), "icon");
    assert.equal(parseNodeStyle("card"), null);
    assert.equal(parseNodeStyle(undefined), null);
  });

  it("is a square with the icon and name centered together", () => {
    const box = getNodeBoxMetrics(40);
    assert.equal(box.width, box.height);
    assert.equal(box.offsetX, (40 - box.width) / 2);
    assert.ok(box.width >= 40 + box.padding * 2);
    assert.equal(box.labelMaxWidth, box.width - box.padding * 2);
    // Centered as one block, nudged down so the gap below the baseline matches the top.
    assert.equal(-box.offsetY - box.labelInset, 3);
    const nameRowTop = box.height - box.labelInset - NODE_BOX_LABEL_LINE_HEIGHT_PX;
    assert.ok(nameRowTop > -box.offsetY + 40);
  });

  it("draws a smaller square with narrow spacing", () => {
    const standard = getNodeBoxMetrics(40);
    const narrow = getNodeBoxMetrics(40, "narrow");
    assert.equal(narrow.width, narrow.height);
    assert.ok(narrow.width < standard.width);
    assert.ok(narrow.width >= 40 + narrow.padding * 2);
    assert.equal(narrow.offsetX, (40 - narrow.width) / 2);
    assert.ok(narrow.labelInset > 0);
    assert.ok(fitNodeBoxLabel("srl-leaf-01", 40, measureByChars, "narrow").text.length <=
      fitNodeBoxLabel("srl-leaf-01", 40, measureByChars).text.length);
  });

  it("parses box spacing", () => {
    assert.equal(parseNodeBoxSpacing("narrow"), "narrow");
    assert.equal(parseNodeBoxSpacing("default"), "default");
    assert.equal(parseNodeBoxSpacing("tight"), null);
  });

  it("uses the spacing for the link rect", () => {
    const narrow = getNodeBoxMetrics(40, "narrow");
    const rect = getNodeConnectionRect({ x: 0, y: 0, width: 40, height: 40 }, "boxed", 40, "narrow");
    assert.equal(rect.width, narrow.width);
    assert.equal(rect.y, narrow.offsetY);
  });

  it("grows the box with large icons and stays square", () => {
    const box = getNodeBoxMetrics(200);
    assert.equal(box.width, box.height);
    assert.ok(box.width >= 200 + box.padding * 2);
    assert.ok(box.labelInset > 0);
  });

  it("applies theme defaults when a node has no box appearance", () => {
    const box = getNodeBoxMetrics(40);
    assert.deepEqual(resolveNodeBoxPaint(undefined, box), {
      fill: undefined,
      fillOpacity: 1,
      blur: 0,
      borderColor: undefined,
      borderWidth: 1,
      cornerRadius: box.borderRadius,
      textColor: undefined,
      shadow: true
    });
    assert.equal(getNodeBoxFillCss(resolveNodeBoxPaint(undefined, box)), NODE_BOX_THEME_COLORS.fill);
  });

  it("resolves a node's box appearance", () => {
    const box = getNodeBoxMetrics(40);
    const paint = resolveNodeBoxPaint(
      { color: "#112233", opacity: 60, blur: 8, borderWidth: 0, cornerRadius: 400, shadow: false },
      box
    );
    assert.equal(paint.fillOpacity, 0.6);
    assert.equal(paint.blur, 8);
    assert.equal(paint.borderWidth, 0);
    // Clamped to the stored maximum, and never more than half the box.
    assert.equal(paint.cornerRadius, Math.min(40, box.width / 2));
    assert.equal(paint.shadow, false);
    assert.equal(getNodeBoxFillCss(paint), "color-mix(in srgb, #112233 60%, transparent)");
  });

  it("returns the icon rect for the icon style", () => {
    const iconRect = { x: 10, y: 20, width: 40, height: 40 };
    assert.deepEqual(getNodeConnectionRect(iconRect, "icon"), iconRect);
  });

  it("expands the connection rect to the box", () => {
    const box = getNodeBoxMetrics(40);
    const rect = getNodeConnectionRect({ x: 10, y: 20, width: 40, height: 40 }, "boxed");
    assert.deepEqual(rect, {
      x: 10 + box.offsetX,
      y: 20 + box.offsetY,
      width: box.width,
      height: box.height
    });
  });

  it("scales the box with a zoomed icon rect", () => {
    const box = getNodeBoxMetrics(40);
    const rect = getNodeConnectionRect({ x: 100, y: 50, width: 80, height: 80 }, "boxed", 40);
    assert.deepEqual(rect, {
      x: 100 + box.offsetX * 2,
      y: 50 + box.offsetY * 2,
      width: box.width * 2,
      height: box.height * 2
    });
  });

  it("keeps a short tail when splitting names", () => {
    assert.deepEqual(splitNodeBoxLabel("srl-leaf-switch-01"), {
      head: "srl-leaf-swi",
      tail: "tch-01"
    });
    assert.deepEqual(splitNodeBoxLabel("srl-leaf-01"), { head: "srl-le", tail: "af-01" });
    assert.deepEqual(splitNodeBoxLabel("srl1"), { head: "sr", tail: "l1" });
    assert.deepEqual(splitNodeBoxLabel(""), { head: "", tail: "" });
  });

  it("does not split surrogate pairs", () => {
    assert.deepEqual(splitNodeBoxLabel("node-🚀-01"), { head: "node-", tail: "🚀-01" });
  });

  it("leaves names that fit untouched", () => {
    assert.deepEqual(truncateNodeBoxLabel("srl1", 100, measureByChars), {
      text: "srl1",
      width: 40,
      truncated: false
    });
  });

  it("truncates long names in the middle", () => {
    const result = truncateNodeBoxLabel("srl-datacenter-leaf-01", 120, measureByChars);
    assert.equal(result.text, "srl-d…eaf-01");
    assert.equal(result.width, 120);
    assert.equal(result.truncated, true);
  });

  it("fits names a pixel inside the label row", () => {
    const box = getNodeBoxMetrics(40);
    const label = "srl-exact-fit";
    const measure = (text: string) => (text === label ? box.labelMaxWidth : 0);
    assert.equal(truncateNodeBoxLabel(label, box.labelMaxWidth, measure).truncated, false);
    assert.equal(fitNodeBoxLabel(label, 40, measure).truncated, true);
  });
});
