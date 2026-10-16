import assert from "node:assert/strict";
import { posix as path } from "node:path";
import test from "node:test";

import { AnnotationsIO } from "./AnnotationsIO";
import type { FileSystemAdapter } from "./types";

function memoryFs(files: Map<string, string>): FileSystemAdapter {
  return {
    async readFile(file) {
      const content = files.get(file);
      if (content === undefined) throw new Error(`ENOENT: no such file ${file}`);
      return content;
    },
    async writeFile(file, content) {
      files.set(file, content);
    },
    async exists(file) {
      return files.has(file);
    },
    async unlink(file) {
      files.delete(file);
    },
    async rename(source, target) {
      files.set(target, files.get(source) ?? "");
      files.delete(source);
    },
    dirname: path.dirname,
    basename: path.basename,
    join: path.join
  };
}

test("a lab without an annotations file starts with boxed nodes and keeps them on save", async () => {
  const files = new Map<string, string>();
  const io = new AnnotationsIO({ fs: memoryFs(files) });

  const annotations = await io.loadAnnotations("/lab.clab.yml");
  assert.equal(annotations.viewerSettings?.nodeStyle, "boxed");

  await io.saveAnnotations("/lab.clab.yml", annotations);
  const saved = JSON.parse(files.get("/lab.clab.yml.annotations.json") ?? "{}");
  assert.equal(saved.viewerSettings.nodeStyle, "boxed");
});

test("an existing annotations file without a node style keeps the icon style", async () => {
  const files = new Map([
    ["/lab.clab.yml.annotations.json", JSON.stringify({ nodeAnnotations: [{ id: "a" }] })]
  ]);
  const io = new AnnotationsIO({ fs: memoryFs(files) });

  const annotations = await io.loadAnnotations("/lab.clab.yml");
  assert.equal(annotations.viewerSettings?.nodeStyle, undefined);
});

test("an unreadable annotations file does not switch the lab to boxed nodes", async () => {
  const files = new Map([["/lab.clab.yml.annotations.json", "{ not json"]]);
  const io = new AnnotationsIO({ fs: memoryFs(files) });

  const annotations = await io.loadAnnotations("/lab.clab.yml");
  assert.equal(annotations.viewerSettings?.nodeStyle, undefined);
});
