import assert from "node:assert/strict";
import { posix as path } from "node:path";
import test from "node:test";

import { TransactionalFileSystemAdapter } from "./TransactionalFileSystemAdapter";
import type { FileSystemAdapter } from "./types";

function fixture(
  fail: (operation: string, source: string, target?: string) => boolean,
  failAfterMutation = false
) {
  const originals = new Map([
    ["/lab.yml", "old yaml"],
    ["/lab.json", "old annotations"]
  ]);
  const files = new Map(originals);
  const check = (operation: string, source: string, target?: string) => {
    if (fail(operation, source, target)) throw new Error(`failed ${operation}: ${source}`);
  };
  const base: FileSystemAdapter = {
    async readFile(file) {
      const content = files.get(file);
      if (content === undefined) throw new Error(`Missing ${file}`);
      return content;
    },
    async writeFile(file, content) {
      if (!failAfterMutation) check("write", file);
      files.set(file, content);
      if (failAfterMutation) check("write", file);
    },
    async exists(file) {
      return files.has(file);
    },
    async unlink(file) {
      check("unlink", file);
      files.delete(file);
    },
    async rename(source, target) {
      if (!failAfterMutation) check("rename", source, target);
      const content = await this.readFile(source);
      files.set(target, content);
      files.delete(source);
      if (failAfterMutation) check("rename", source, target);
    },
    dirname: path.dirname,
    basename: path.basename,
    join: path.join
  };
  return { files, originals, fs: new TransactionalFileSystemAdapter(base) };
}

for (const phase of ["temporary write", "backup", "replacement"] as const) {
  test(`a failed second ${phase} restores both original files`, async () => {
    const { fs, files, originals } = fixture((operation, source, target) => {
      if (phase === "temporary write") return operation === "write" && source.endsWith("-lab.json");
      if (phase === "backup") return operation === "rename" && source === "/lab.json";
      return operation === "rename" && source.includes(".tmp-") && target === "/lab.json";
    });
    fs.beginTransaction();
    await fs.writeFile("/lab.yml", "new yaml");
    await fs.writeFile("/lab.json", "new annotations");
    await assert.rejects(fs.commitTransaction(), /failed/);
    assert.deepEqual(files, originals);
    assert.equal(fs.isInTransaction(), false);
  });
}

test("rollback removes newly created files and restores deletions", async () => {
  const { fs, files, originals } = fixture(
    (operation, source, target) =>
      operation === "rename" && source.includes(".tmp-") && target === "/lab.json"
  );
  fs.beginTransaction();
  await fs.unlink("/lab.yml");
  await fs.writeFile("/new.yml", "new file");
  await fs.writeFile("/lab.json", "new annotations");
  await assert.rejects(fs.commitTransaction());
  assert.deepEqual(files, originals);
});

test("backup cleanup failure does not report a successful save as failed", async () => {
  const { fs, files } = fixture(
    (operation, source) => operation === "unlink" && source.includes(".bak-")
  );
  fs.beginTransaction();
  await fs.writeFile("/lab.yml", "new yaml");
  await fs.writeFile("/lab.json", "new annotations");
  await fs.commitTransaction();
  assert.equal(files.get("/lab.yml"), "new yaml");
  assert.equal(files.get("/lab.json"), "new annotations");
});

test("failed recovery reports the retained backup", async () => {
  const { fs, files } = fixture(
    (operation, source, target) =>
      operation === "rename" &&
      ((source.includes(".tmp-") && target === "/lab.json") || source.includes(".bak-"))
  );
  fs.beginTransaction();
  await fs.writeFile("/lab.yml", "new yaml");
  await fs.writeFile("/lab.json", "new annotations");
  await assert.rejects(fs.commitTransaction(), /backup retained at/);
  assert.equal([...files.entries()].filter(([file]) => file.includes(".bak-")).length, 2);
});

for (const phase of ["backup", "replacement"] as const) {
  test(`a lost acknowledgement after ${phase} still restores the originals`, async () => {
    const { fs, files, originals } = fixture(
      (operation, source, target) =>
        operation === "rename" &&
        (phase === "backup"
          ? source === "/lab.json"
          : source.includes(".tmp-") && target === "/lab.json"),
      true
    );
    fs.beginTransaction();
    await fs.writeFile("/lab.yml", "new yaml");
    await fs.writeFile("/lab.json", "new annotations");
    await assert.rejects(fs.commitTransaction());
    assert.deepEqual(files, originals);
  });
}

test("a failed delete rolls back preceding writes", async () => {
  const { fs, files, originals } = fixture((operation, source) =>
    operation === "unlink" && source === "/lab.json"
  );
  fs.beginTransaction();
  await fs.writeFile("/lab.yml", "new yaml");
  await fs.unlink("/lab.json");
  await assert.rejects(fs.commitTransaction());
  assert.deepEqual(files, originals);
});
