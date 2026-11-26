/**
 * RenderedTopologyFileSystem - a topology template as the topology it renders to.
 *
 * Only containerlab can turn a `.clab.gotmpl` template into a topology. Behind
 * this adapter the template reads as what containerlab renders from it, so the
 * topology core parses it like any topology file, and it is never written:
 * the template is edited as text.
 */

import * as YAML from "yaml";

import type { TopologyTemplateState } from "../types/messages";
import { isRecord } from "../utilities/typeHelpers";

import type { FileSystemAdapter } from "./types";

/** A topology template as containerlab renders it. */
interface RenderedTopologySource {
  /** Topology YAML after the template is expanded. */
  content: string;
  /** Variables files containerlab used. */
  varsFiles?: string[];
  /** Why containerlab rejects the rendered topology, when it does. */
  error?: string;
}

/** Renders the template with containerlab; fails when it cannot be rendered. */
export type TopologyRenderer = () => Promise<RenderedTopologySource>;

interface Rendering {
  content: string;
  state: TopologyTemplateState;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Whether a template is a YAML map as it is written, so it can be drawn without rendering. */
function isYamlMap(source: string): boolean {
  try {
    const document = YAML.parseDocument(source);
    return document.errors.length === 0 && isRecord(document.toJS());
  } catch {
    return false;
  }
}

export class RenderedTopologyFileSystem implements FileSystemAdapter {
  private readonly base: FileSystemAdapter;
  private readonly templatePath: string;
  private readonly render: TopologyRenderer;
  /** The rendering of the template text last read. */
  private rendering: { source: string; result: Promise<Rendering> } | null = null;
  /** What containerlab last rendered, kept while the template does not render. */
  private lastRendered: string | undefined;
  private state: TopologyTemplateState = { source: "text" };

  constructor(base: FileSystemAdapter, templatePath: string, render: TopologyRenderer) {
    this.base = base;
    this.templatePath = templatePath;
    this.render = render;
  }

  /** How the content last read from the template came about. */
  templateState(): TopologyTemplateState {
    return this.state;
  }

  /**
   * Renders the template again on its next read. A changed template text does
   * that on its own; this is for what else decides the result, such as its
   * variables files.
   */
  refresh(): void {
    this.rendering = null;
  }

  invalidateCache(): void {
    this.base.invalidateCache?.();
  }

  async readFile(filePath: string): Promise<string> {
    if (filePath !== this.templatePath) {
      return this.base.readFile(filePath);
    }
    const source = await this.base.readFile(filePath);
    if (this.rendering?.source !== source) {
      this.rendering = { source, result: this.renderSource(source) };
    }
    const rendering = await this.rendering.result;
    this.state = rendering.state;
    return rendering.content;
  }

  private async renderSource(source: string): Promise<Rendering> {
    try {
      const rendered = await this.render();
      this.lastRendered = rendered.content;
      return {
        content: rendered.content,
        state: {
          source: "rendered",
          ...(rendered.varsFiles && rendered.varsFiles.length > 0
            ? { varsFiles: rendered.varsFiles }
            : {}),
          ...(rendered.error ? { error: rendered.error } : {})
        }
      };
    } catch (error) {
      const message = errorMessage(error);
      if (this.lastRendered !== undefined) {
        return { content: this.lastRendered, state: { source: "last-rendered", error: message } };
      }
      // Never rendered, e.g. by a containerlab that cannot: a template that is
      // plain YAML but for its values still shows its nodes and links.
      return { content: isYamlMap(source) ? source : "", state: { source: "text", error: message } };
    }
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    this.assertNotTemplate(filePath);
    await this.base.writeFile(filePath, content);
  }

  async unlink(filePath: string): Promise<void> {
    this.assertNotTemplate(filePath);
    await this.base.unlink(filePath);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    this.assertNotTemplate(oldPath);
    this.assertNotTemplate(newPath);
    await this.base.rename(oldPath, newPath);
  }

  exists(filePath: string): Promise<boolean> {
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

  private assertNotTemplate(filePath: string): void {
    if (filePath === this.templatePath) {
      throw new Error(`${this.base.basename(filePath)} is a topology template: edit it as text.`);
    }
  }
}
