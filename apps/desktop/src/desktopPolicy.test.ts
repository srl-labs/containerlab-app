import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildEditMenu,
  decideNavigation,
  decideWindowOpen,
  isAllowedExternalUrl,
  parsePortEnv,
  parseTitleBarOverlay,
  sanitizeWindowState,
  type EditMenuEntry,
  type EditMenuRequest
} from "./desktopPolicy.ts";

const ORIGIN = "http://127.0.0.1:32180";

const REFUSED_SCHEMES = [
  "file:///etc/passwd",
  "javascript:alert(1)",
  "smb://fileserver/share",
  "vscode://file/etc/passwd",
  "ms-settings:privacy",
  "data:text/html,<p>hi</p>",
  "about:blank"
];

const MALFORMED_URLS = [
  "",
  "not a url",
  "/terminal.html",
  "//evil.test/terminal.html",
  "http://",
  "http://127.0.0.1:32180.evil.test/terminal.html"
];

describe("parsePortEnv", () => {
  test("accepts ports in range, ignoring surrounding whitespace", () => {
    assert.equal(parsePortEnv("8080", 1), 8080);
    assert.equal(parsePortEnv(" 1 ", 2), 1);
    assert.equal(parsePortEnv("65535", 1), 65535);
  });

  test("falls back for missing, out of range or partially numeric values", () => {
    for (const value of [undefined, "", "   ", "0", "65536", "-1", "80abc", "1.5", "1e3", "0x50"]) {
      assert.equal(parsePortEnv(value, 32180), 32180, `value ${JSON.stringify(value)}`);
    }
  });
});

describe("isAllowedExternalUrl", () => {
  test("allows http, https and mailto", () => {
    assert.equal(isAllowedExternalUrl("https://containerlab.dev/"), true);
    assert.equal(isAllowedExternalUrl("HTTP://example.test/path"), true);
    assert.equal(isAllowedExternalUrl("mailto:containerlab@containerlab.dev"), true);
  });

  test("refuses other schemes and malformed URLs", () => {
    for (const url of [...REFUSED_SCHEMES, ...MALFORMED_URLS]) {
      assert.equal(isAllowedExternalUrl(url), false, url);
    }
  });
});

describe("decideNavigation", () => {
  test("keeps same-origin app URLs in the window", () => {
    assert.equal(decideNavigation(`${ORIGIN}/`, ORIGIN), "allow");
    assert.equal(decideNavigation(`${ORIGIN}/#/labs?name=srl`, ORIGIN), "allow");
    assert.equal(decideNavigation(`${ORIGIN}/terminal.html?node=srl1`, ORIGIN), "allow");
  });

  test("opens external http(s) and mailto URLs outside the app", () => {
    assert.equal(decideNavigation("https://containerlab.dev/manual/", ORIGIN), "external");
    assert.equal(decideNavigation("mailto:containerlab@containerlab.dev", ORIGIN), "external");
  });

  test("treats other loopback ports and hosts as external", () => {
    assert.equal(decideNavigation("http://127.0.0.1:32181/", ORIGIN), "external");
    assert.equal(decideNavigation("http://localhost:32180/", ORIGIN), "external");
    assert.equal(decideNavigation("https://127.0.0.1:32180/", ORIGIN), "external");
  });

  test("refuses other schemes and malformed URLs", () => {
    for (const url of [...REFUSED_SCHEMES, ...MALFORMED_URLS]) {
      assert.equal(decideNavigation(url, ORIGIN), "block", url);
    }
  });
});

describe("decideWindowOpen", () => {
  test("routes the terminal and Wireshark pages to their own windows", () => {
    assert.equal(decideWindowOpen(`${ORIGIN}/terminal.html?node=srl1`, ORIGIN), "terminal");
    assert.equal(decideWindowOpen(`${ORIGIN}/wireshark.html?session=abc#vnc`, ORIGIN), "wireshark");
  });

  test("hands other same-origin pages and external http(s) URLs to the browser", () => {
    assert.equal(decideWindowOpen(`${ORIGIN}/`, ORIGIN), "external");
    assert.equal(decideWindowOpen(`${ORIGIN}/sub/terminal.html`, ORIGIN), "external");
    assert.equal(decideWindowOpen("https://containerlab.app", ORIGIN), "external");
    assert.equal(decideWindowOpen("mailto:containerlab@containerlab.dev", ORIGIN), "external");
  });

  test("does not route look-alike origins to app windows", () => {
    for (const url of [
      "http://127.0.0.1.evil.test:32180/terminal.html",
      "http://127.0.0.1:32180@evil.test/terminal.html",
      "http://evil.test/wireshark.html?origin=http://127.0.0.1:32180",
      "http://127.0.0.1:32181/terminal.html"
    ]) {
      assert.equal(decideWindowOpen(url, ORIGIN), "external", url);
    }
  });

  test("refuses other schemes, same-origin blobs and malformed URLs", () => {
    for (const url of [...REFUSED_SCHEMES, ...MALFORMED_URLS, `blob:${ORIGIN}/0b1c`]) {
      assert.equal(decideWindowOpen(url, ORIGIN), "block", url);
    }
  });
});

describe("buildEditMenu", () => {
  const noFlags: EditMenuRequest["editFlags"] = {
    canUndo: false,
    canRedo: false,
    canCut: false,
    canCopy: false,
    canPaste: false,
    canDelete: false,
    canSelectAll: false,
    canEditRichly: false
  };

  function request(overrides: Partial<EditMenuRequest> = {}): EditMenuRequest {
    return { isEditable: false, selectionText: "", linkURL: "", editFlags: noFlags, ...overrides };
  }

  function summarize(entries: EditMenuEntry[]): string[] {
    return entries.map((entry) =>
      "id" in entry ? `${entry.id}${entry.enabled ? "" : " (disabled)"}` : "---"
    );
  }

  test("editable fields get the full edit menu with Chromium's enabled flags", () => {
    const entries = buildEditMenu(
      request({
        isEditable: true,
        editFlags: { ...noFlags, canUndo: true, canPaste: true, canSelectAll: true }
      })
    );
    assert.deepEqual(summarize(entries), [
      "undo",
      "redo (disabled)",
      "---",
      "cut (disabled)",
      "copy (disabled)",
      "paste",
      "delete (disabled)",
      "---",
      "selectAll"
    ]);
  });

  test("selected read-only text offers Copy and Select All", () => {
    assert.deepEqual(summarize(buildEditMenu(request({ selectionText: "srl1" }))), [
      "copy",
      "selectAll"
    ]);
    assert.deepEqual(
      summarize(buildEditMenu(request({ editFlags: { ...noFlags, canCopy: true } }))),
      ["copy", "selectAll"]
    );
  });

  test("links add Open Link and Copy Link after a separator", () => {
    assert.deepEqual(
      summarize(
        buildEditMenu(request({ selectionText: "docs", linkURL: "https://containerlab.dev/" }))
      ),
      ["copy", "selectAll", "---", "openLink", "copyLink"]
    );
    assert.deepEqual(summarize(buildEditMenu(request({ linkURL: "https://containerlab.dev/" }))), [
      "openLink",
      "copyLink"
    ]);
  });

  test("Open Link is disabled for schemes that cannot be opened externally", () => {
    assert.deepEqual(summarize(buildEditMenu(request({ linkURL: "file:///etc/passwd" }))), [
      "openLink (disabled)",
      "copyLink"
    ]);
  });

  test("plain UI surfaces get no menu unless the click is over selectable text", () => {
    assert.deepEqual(buildEditMenu(request()), []);
    assert.deepEqual(summarize(buildEditMenu(request(), true)), ["copy (disabled)", "selectAll"]);
  });
});

describe("parseTitleBarOverlay", () => {
  const valid = { color: "#000000", symbolColor: "#ececec", height: 40 };

  test("accepts hex colors and a sane height", () => {
    assert.deepEqual(parseTitleBarOverlay(valid), valid);
    assert.deepEqual(parseTitleBarOverlay({ ...valid, color: "#00000000", height: 39.6 }), {
      color: "#00000000",
      symbolColor: "#ececec",
      height: 40
    });
  });

  test("rejects anything else the page could send", () => {
    for (const value of [
      null,
      "x",
      {},
      { ...valid, color: "red" },
      { ...valid, color: "#fff" },
      { ...valid, symbolColor: "rgb(0,0,0)" },
      { ...valid, height: 0 },
      { ...valid, height: 500 },
      { ...valid, height: Number.NaN },
      { ...valid, height: "36" }
    ]) {
      assert.equal(parseTitleBarOverlay(value), null);
    }
  });
});

describe("sanitizeWindowState", () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];

  test("falls back to the default size when nothing usable was saved", () => {
    for (const saved of [undefined, null, "x", { width: 10, height: 10 }, { width: "1", height: "2" }]) {
      assert.deepEqual(sanitizeWindowState(saved, displays), { width: 1280, height: 900, maximized: false });
    }
  });

  test("restores size, position and maximized state", () => {
    const saved = { x: 100, y: 50, width: 1400, height: 800, maximized: true };
    assert.deepEqual(sanitizeWindowState(saved, displays), saved);
  });

  test("drops a position that is no longer on any display but keeps the size", () => {
    const state = sanitizeWindowState({ x: 4000, y: 50, width: 1400, height: 800 }, displays);
    assert.deepEqual(state, { width: 1400, height: 800, maximized: false });
  });

  test("drops a position whose title bar is above the display", () => {
    const state = sanitizeWindowState({ x: 100, y: -300, width: 1400, height: 800 }, displays);
    assert.equal(state.y, undefined);
  });
});
