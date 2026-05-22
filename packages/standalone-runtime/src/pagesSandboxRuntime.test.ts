import assert from "node:assert/strict";
import test from "node:test";

import { BrowserSandboxFileSystem } from "./pagesSandboxRuntime";

class TestStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("BrowserSandboxFileSystem reads, writes, checks, and deletes files", async () => {
  const fs = new BrowserSandboxFileSystem(new TestStorage());

  assert.equal(await fs.exists("labs/demo.clab.yml"), false);
  await fs.writeFile("labs/demo.clab.yml", "name: demo\n");

  assert.equal(await fs.exists("labs/demo.clab.yml"), true);
  assert.equal(await fs.readFile("labs/demo.clab.yml"), "name: demo\n");

  await fs.unlink("labs/demo.clab.yml");
  assert.equal(await fs.exists("labs/demo.clab.yml"), false);
  await assert.rejects(() => fs.readFile("labs/demo.clab.yml"), /ENOENT/);
});

test("BrowserSandboxFileSystem renames files and persists directory ancestors", async () => {
  const storage = new TestStorage();
  const fs = new BrowserSandboxFileSystem(storage);

  await fs.writeFile("./labs/demo.clab.yml", "name: demo\n");
  await fs.rename("labs/demo.clab.yml", "renamed/demo.clab.yml");

  assert.equal(await fs.exists("labs/demo.clab.yml"), false);
  assert.equal(await fs.readFile("renamed/demo.clab.yml"), "name: demo\n");
  assert.deepEqual([...fs.readDirectories()].sort(), ["labs", "renamed"]);
});

test("BrowserSandboxFileSystem path helpers use browser-safe posix paths", () => {
  const fs = new BrowserSandboxFileSystem(new TestStorage());

  assert.equal(fs.dirname("labs/demo.clab.yml"), "labs");
  assert.equal(fs.dirname("demo.clab.yml"), ".");
  assert.equal(fs.basename("labs/demo.clab.yml"), "demo.clab.yml");
  assert.equal(fs.join("labs", ".", "demo.clab.yml"), "labs/demo.clab.yml");
});
