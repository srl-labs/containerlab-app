import assert from "node:assert/strict";
import test from "node:test";

import type { CustomNodeTemplate } from "../types/editors";
import {
  NODE_TEMPLATES_EXPORT_FILE_TYPE,
  collectCustomIconsForTemplates,
  mergeCustomNodeTemplates,
  parseCustomNodeTemplatesExport,
  parseCustomNodeTemplatesExportFile,
  serializeCustomNodeTemplates
} from "./customNodeImportExport";

function template(name: string, extra: Partial<CustomNodeTemplate> = {}): CustomNodeTemplate {
  return { name, kind: "nokia_srlinux", ...extra };
}

test("serialize/parse round-trips templates through the export format", () => {
  const templates = [
    template("srl", { image: "ghcr.io/nokia/srlinux:latest", icon: "leaf" }),
    template("ceos", { kind: "arista_ceos", setDefault: true })
  ];

  const content = serializeCustomNodeTemplates(templates);
  const parsed = JSON.parse(content) as Record<string, unknown>;
  assert.equal(parsed.fileType, NODE_TEMPLATES_EXPORT_FILE_TYPE);

  assert.deepEqual(parseCustomNodeTemplatesExport(content), templates);
});

test("serialize/parse round-trips embedded custom icons", () => {
  const templates = [template("custom", { icon: "my-router" })];
  const icons = [
    {
      name: "my-router",
      dataUri: "data:image/svg+xml;base64,PHN2Zy8+",
      format: "svg" as const
    }
  ];

  const content = serializeCustomNodeTemplates(templates, icons);
  assert.deepEqual(parseCustomNodeTemplatesExportFile(content), { templates, icons });
  assert.deepEqual(parseCustomNodeTemplatesExport(content), templates);
});

test("collectCustomIconsForTemplates includes only referenced custom icons", () => {
  const templates = [
    template("custom", { icon: "my-router" }),
    template("default-icon"),
    template("built-in", { icon: "leaf" })
  ];
  const customIcons = [
    {
      name: "my-router",
      source: "global" as const,
      dataUri: "data:image/svg+xml;base64,PHN2Zy8+",
      format: "svg" as const
    },
    {
      name: "unused",
      source: "global" as const,
      dataUri: "data:image/png;base64,iVBORw0KGgo=",
      format: "png" as const
    },
    {
      name: "pe",
      source: "workspace" as const,
      dataUri: "data:image/svg+xml;base64,PHN2ZyBpZD0icGUiLz4=",
      format: "svg" as const
    }
  ];

  assert.deepEqual(collectCustomIconsForTemplates(templates, customIcons), [
    {
      name: "my-router",
      dataUri: "data:image/svg+xml;base64,PHN2Zy8+",
      format: "svg"
    },
    {
      name: "pe",
      dataUri: "data:image/svg+xml;base64,PHN2ZyBpZD0icGUiLz4=",
      format: "svg"
    }
  ]);
});

test("parse accepts a bare template array", () => {
  const content = JSON.stringify([template("srl")]);
  assert.deepEqual(parseCustomNodeTemplatesExport(content), [template("srl")]);
});

test("parse keeps the last entry when the file repeats a name", () => {
  const content = JSON.stringify([template("srl"), template("srl", { type: "ixr-d2" })]);
  assert.deepEqual(parseCustomNodeTemplatesExport(content), [template("srl", { type: "ixr-d2" })]);
});

test("parse rejects invalid JSON", () => {
  assert.throws(() => parseCustomNodeTemplatesExport("{nope"), /not valid JSON/);
});

test("parse rejects files without a templates array", () => {
  assert.throws(() => parseCustomNodeTemplatesExport('{"foo": 1}'), /templates/);
});

test("parse rejects mismatched fileType", () => {
  const content = JSON.stringify({ fileType: "something-else", templates: [template("srl")] });
  assert.throws(() => parseCustomNodeTemplatesExport(content), /Not a node templates file/);
});

test("parse rejects empty template lists", () => {
  const content = JSON.stringify({
    fileType: NODE_TEMPLATES_EXPORT_FILE_TYPE,
    version: 1,
    templates: []
  });
  assert.throws(() => parseCustomNodeTemplatesExport(content), /no node templates/);
});

test("parse rejects templates without name or kind", () => {
  const content = JSON.stringify([{ name: "srl" }]);
  assert.throws(() => parseCustomNodeTemplatesExport(content), /index 0/);
});

test("parse rejects invalid embedded icons", () => {
  const content = JSON.stringify({
    fileType: NODE_TEMPLATES_EXPORT_FILE_TYPE,
    version: 2,
    templates: [template("srl")],
    icons: [{ name: "my-router", format: "svg" }]
  });
  assert.throws(() => parseCustomNodeTemplatesExportFile(content), /Icon at index 0/);
});

test("parse keeps the last icon entry when the file repeats a name", () => {
  const content = JSON.stringify({
    fileType: NODE_TEMPLATES_EXPORT_FILE_TYPE,
    version: 2,
    templates: [template("srl")],
    icons: [
      { name: "my-router", dataUri: "data:image/svg+xml;base64,old", format: "svg" },
      { name: "my-router", dataUri: "data:image/svg+xml;base64,new", format: "svg" }
    ]
  });
  assert.deepEqual(parseCustomNodeTemplatesExportFile(content).icons, [
    { name: "my-router", dataUri: "data:image/svg+xml;base64,new", format: "svg" }
  ]);
});

test("merge replaces same-named templates and appends new ones", () => {
  const existing = [template("a", { image: "old" }), template("b")];
  const imported = [template("a", { image: "new" }), template("c")];

  const result = mergeCustomNodeTemplates(existing, imported);
  assert.equal(result.replaced, 1);
  assert.equal(result.added, 1);
  assert.deepEqual(
    result.customNodes.map((t) => [t.name, t.image]),
    [
      ["a", "new"],
      ["b", undefined],
      ["c", undefined]
    ]
  );
});

test("merge keeps the existing default over imported default flags", () => {
  const existing = [template("a", { setDefault: true }), template("b")];
  const imported = [template("c", { setDefault: true })];

  const { customNodes } = mergeCustomNodeTemplates(existing, imported);
  const defaults = customNodes.filter((t) => t.setDefault === true).map((t) => t.name);
  assert.deepEqual(defaults, ["a"]);
});

test("merge keeps the default name when the default template is replaced", () => {
  const existing = [template("a", { setDefault: true }), template("b")];
  const imported = [template("a", { image: "new" })];

  const { customNodes } = mergeCustomNodeTemplates(existing, imported);
  const defaults = customNodes.filter((t) => t.setDefault === true).map((t) => t.name);
  assert.deepEqual(defaults, ["a"]);
});

test("merge adopts an imported default when none exists", () => {
  const existing = [template("a")];
  const imported = [template("b", { setDefault: true }), template("c", { setDefault: true })];

  const { customNodes } = mergeCustomNodeTemplates(existing, imported);
  const defaults = customNodes.filter((t) => t.setDefault === true).map((t) => t.name);
  assert.deepEqual(defaults, ["b"]);
});
