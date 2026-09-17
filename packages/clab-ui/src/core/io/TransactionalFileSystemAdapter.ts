/**
 * TransactionalFileSystemAdapter
 *
 * Buffers writes/deletes and restores the original files if a commit fails.
 * Individual renames are atomic where supported; a multi-file commit is not
 * crash-atomic. Backups are retained if recovery itself fails.
 */

import type { FileSystemAdapter } from "./types";

type PendingEntry = { path: string; content: string | null };

export class TransactionalFileSystemAdapter implements FileSystemAdapter {
  private base: FileSystemAdapter;
  private inTransaction = false;
  private pending = new Map<string, string | null>();

  constructor(base: FileSystemAdapter) {
    this.base = base;
  }

  beginTransaction(): void {
    if (this.inTransaction) return;
    this.inTransaction = true;
  }

  async commitTransaction(): Promise<void> {
    if (!this.inTransaction) return;
    const entries: PendingEntry[] = Array.from(this.pending.entries()).map(([path, content]) => ({
      path,
      content
    }));
    this.pending.clear();
    this.inTransaction = false;
    if (entries.length === 0) return;
    await this.commitEntries(entries);
  }

  rollbackTransaction(): void {
    this.pending.clear();
    this.inTransaction = false;
  }

  isInTransaction(): boolean {
    return this.inTransaction;
  }

  // ---------------------------------------------------------------------------
  // FileSystemAdapter implementation
  // ---------------------------------------------------------------------------

  async readFile(filePath: string): Promise<string> {
    if (this.inTransaction && this.pending.has(filePath)) {
      const value = this.pending.get(filePath);
      if (value === null) {
        throw new Error(`ENOENT: no such file ${filePath}`);
      }
      if (value === undefined) {
        throw new Error(`Missing pending entry for ${filePath}`);
      }
      return value;
    }
    return this.base.readFile(filePath);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    if (this.inTransaction) {
      this.pending.set(filePath, content);
      return;
    }
    await this.base.writeFile(filePath, content);
  }

  async unlink(filePath: string): Promise<void> {
    if (this.inTransaction) {
      this.pending.set(filePath, null);
      return;
    }
    await this.base.unlink(filePath);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    if (this.inTransaction) {
      const content = await this.readFile(oldPath);
      this.pending.set(newPath, content);
      this.pending.set(oldPath, null);
      return;
    }
    await this.base.rename(oldPath, newPath);
  }

  async exists(filePath: string): Promise<boolean> {
    if (this.inTransaction && this.pending.has(filePath)) {
      return this.pending.get(filePath) !== null;
    }
    return this.base.exists(filePath);
  }

  dirname(filePath: string): string {
    return this.base.dirname(filePath);
  }

  basename(filePath: string): string {
    return this.base.basename(filePath);
  }

  join(...segments: string[]): string {
    return this.base.join(...segments);
  }

  // ---------------------------------------------------------------------------
  // Commit logic
  // ---------------------------------------------------------------------------

  private generateId(): string {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    let value = "";
    for (let index = 0; index < 24; index++) {
      const randomIndex = Math.floor(Math.random() * alphabet.length);
      value += alphabet[randomIndex];
    }
    return value;
  }

  private buildTempPath(dir: string, base: string, prefix: "tmp" | "bak"): string {
    return this.base.join(dir, `.${prefix}-${this.generateId()}-${base}`);
  }

  private async writeTempFiles(
    entries: PendingEntry[],
    tempFiles: Map<string, string>
  ): Promise<void> {
    for (const entry of entries) {
      if (entry.content === null) continue;
      const dir = this.base.dirname(entry.path);
      const base = this.base.basename(entry.path);
      const tempPath = this.buildTempPath(dir, base, "tmp");
      tempFiles.set(entry.path, tempPath);
      await this.base.writeFile(tempPath, entry.content);
    }
  }

  private async createBackups(
    entries: PendingEntry[],
    backups: Map<string, string>
  ): Promise<void> {
    for (const entry of entries) {
      const exists = await this.base.exists(entry.path);
      if (!exists) continue;
      const dir = this.base.dirname(entry.path);
      const base = this.base.basename(entry.path);
      const backupPath = this.buildTempPath(dir, base, "bak");
      backups.set(entry.path, backupPath);
      await this.base.rename(entry.path, backupPath);
    }
  }

  private async applyWrites(
    entries: PendingEntry[],
    tempFiles: Map<string, string>,
    attemptedWrites: Set<string>
  ): Promise<void> {
    for (const entry of entries) {
      if (entry.content === null) continue;
      const tempPath = tempFiles.get(entry.path);
      if (tempPath === undefined || tempPath.length === 0) {
        throw new Error(`Missing temp file for ${entry.path}`);
      }
      attemptedWrites.add(entry.path);
      await this.base.rename(tempPath, entry.path);
    }
  }

  private async cleanupBackups(backups: Map<string, string>): Promise<void> {
    for (const backupPath of backups.values()) {
      try {
        await this.base.unlink(backupPath);
      } catch {
        // The commit has succeeded. Keep a leftover backup rather than report
        // a failed save after some of the other backups have been deleted.
      }
    }
  }

  private async restoreBackups(
    backups: Map<string, string>,
    attemptedWrites: Set<string>
  ): Promise<void> {
    const errors: Error[] = [];
    for (const targetPath of attemptedWrites) {
      if (backups.has(targetPath)) continue;
      try {
        await this.base.unlink(targetPath);
      } catch (cause) {
        errors.push(new Error(`Could not remove incomplete file ${targetPath}`, { cause }));
      }
    }
    for (const [targetPath, backupPath] of backups) {
      try {
        if (!(await this.base.exists(backupPath))) continue;
        // Replace in place: running topology documents cannot be unlinked.
        await this.base.rename(backupPath, targetPath);
      } catch (cause) {
        errors.push(
          new Error(`Could not restore ${targetPath}; backup retained at ${backupPath}`, { cause })
        );
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, errors.map((error) => error.message).join("; "));
    }
  }

  private async cleanupTempFiles(tempFiles: Map<string, string>): Promise<void> {
    for (const tempPath of tempFiles.values()) {
      try {
        await this.base.unlink(tempPath);
      } catch {
        // ignore cleanup errors
      }
    }
  }

  private async commitEntries(entries: PendingEntry[]): Promise<void> {
    if (entries.length === 0) return;

    const tempFiles = new Map<string, string>();
    const backups = new Map<string, string>();
    const attemptedWrites = new Set<string>();

    try {
      // 1) Write temp files for all writes.
      await this.writeTempFiles(entries, tempFiles);

      // 2) Move existing targets to backups.
      await this.createBackups(entries, backups);

      // 3) Apply writes (rename temp -> target).
      await this.applyWrites(entries, tempFiles, attemptedWrites);

      // Some remote adapters defer removal when moving a document to a backup.
      // Complete deletions before cleanup so failures can still be rolled back.
      for (const entry of entries) {
        if (entry.content === null) await this.base.unlink(entry.path);
      }
    } catch (err) {
      try {
        await this.restoreBackups(backups, attemptedWrites);
      } catch (recoveryError) {
        throw new AggregateError(
          [err, recoveryError],
          `Save failed and recovery was incomplete: ${String(recoveryError)}`
        );
      } finally {
        await this.cleanupTempFiles(tempFiles);
      }
      throw err;
    }
    await this.cleanupBackups(backups);
  }
}
