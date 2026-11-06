declare module "monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js" {
  import type { IDisposable } from "monaco-editor";
  /** Undefined where Monaco expects no clipboard access, and so adds no "Paste" entry. */
  export const PasteAction:
    | {
        addImplementation(
          priority: number,
          name: string,
          implementation: () => boolean | Promise<void>
        ): IDisposable;
      }
    | undefined;
}
