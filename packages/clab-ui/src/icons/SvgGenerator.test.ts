import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BUILTIN_ICONS,
  extractUsedCustomIcons,
  isBuiltInIcon,
  resolveBuiltInIcon
} from "../core/types/icons";
import { getRoleIcon } from "../core/types/graph";

import { getIconInk } from "./iconInk";
import { BUILT_IN_ICON_LABELS, ICON_INK, generateEncodedSVG, generateLiteSVG } from "./SvgGenerator";

function decode(dataUri: string): string {
  return decodeURIComponent(dataUri.slice(dataUri.indexOf(",") + 1));
}

describe("built-in icons", () => {
  it("draws a different symbol for every icon, with a label", () => {
    const symbols = new Set(
      BUILTIN_ICONS.map((icon) => decode(generateEncodedSVG(icon, "#00c9ff", ICON_INK.dark)))
    );
    assert.equal(symbols.size, BUILTIN_ICONS.length);
    for (const icon of BUILTIN_ICONS) assert.ok(BUILT_IN_ICON_LABELS[icon].length > 0);
  });

  it("paints the frame in the ink and the symbol in the icon color", () => {
    const svg = decode(generateEncodedSVG("router", "#ff6600", ICON_INK.light));
    assert.match(svg, /<path d="M29 [^"]+" fill="none" stroke="#001135"/);
    assert.match(svg, /<g color="#ff6600"[^>]* stroke="currentColor"/);
    assert.notEqual(
      generateEncodedSVG("router", "#ff6600", ICON_INK.light),
      generateEncodedSVG("router", "#ff6600", ICON_INK.dark)
    );
  });

  it("keeps colors from breaking out of their attribute or an unquoted CSS url()", () => {
    const uri = generateEncodedSVG("switch", 'rgb(1, 2, 3)"><script>', ICON_INK.dark);
    assert.ok(!/['()]/.test(uri));
    assert.ok(!decode(uri).includes("<script>"));
  });

  it("draws the low-detail icon in the icon color", () => {
    assert.match(decode(generateLiteSVG("#ff6600", ICON_INK.dark)), /color="#ff6600"/);
  });

  it("keeps older icon names working", () => {
    assert.equal(resolveBuiltInIcon("pe"), "router");
    assert.equal(resolveBuiltInIcon("bridge"), "switch");
    assert.equal(resolveBuiltInIcon("my-icon"), undefined);
    assert.ok(isBuiltInIcon("pe"));
    assert.ok(!isBuiltInIcon("my-icon"));
    assert.equal(getRoleIcon("default"), "router");
    assert.equal(getRoleIcon("pe"), "router");
    assert.equal(getRoleIcon("super-spine"), "super-spine");
    assert.equal(getRoleIcon("unknown"), "router");
  });
});

describe("used custom icons", () => {
  it("keeps a custom icon that shares a built-in name", () => {
    const nodes = ["firewall", "router", "my-icon", ""].map((role) => ({
      data: { topoViewerRole: role }
    }));
    assert.deepEqual(extractUsedCustomIcons(nodes), ["my-icon"]);
    assert.deepEqual(extractUsedCustomIcons(nodes, new Set(["firewall"])), ["firewall", "my-icon"]);
  });
});

describe("icon ink", () => {
  it("uses the navy ink on light backgrounds and the pale ink on dark ones", () => {
    assert.equal(getIconInk("#ffffff"), ICON_INK.light);
    assert.equal(getIconInk("rgb(240, 240, 240)"), ICON_INK.light);
    assert.equal(getIconInk("#1e1e1e"), ICON_INK.dark);
    assert.equal(getIconInk("#001135"), ICON_INK.dark);
  });
});
