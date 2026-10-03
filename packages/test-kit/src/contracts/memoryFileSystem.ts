import type { FileSystemAdapter } from "@containerlab/clab-ui/session";

/** In-memory POSIX file system for running the shared topology core in tests. */
export class MemoryFileSystem implements FileSystemAdapter {
  readonly files: Map<string, string>;

  constructor(files: Record<string, string> = {}) {
    this.files = new Map(Object.entries(files));
  }

  async readFile(filePath: string): Promise<string> {
    const content = this.files.get(filePath);
    if (content === undefined) throw new Error(`ENOENT: no such file ${filePath}`);
    return content;
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }

  async unlink(filePath: string): Promise<void> {
    this.files.delete(filePath);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const content = await this.readFile(oldPath);
    this.files.delete(oldPath);
    this.files.set(newPath, content);
  }

  async exists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }

  dirname(filePath: string): string {
    const index = filePath.lastIndexOf("/");
    return index <= 0 ? "/" : filePath.slice(0, index);
  }

  basename(filePath: string): string {
    return filePath.slice(filePath.lastIndexOf("/") + 1);
  }

  join(...segments: string[]): string {
    return segments.join("/").replace(/\/+/g, "/");
  }
}
