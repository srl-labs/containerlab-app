import { useCallback, useMemo, useRef } from "react";
import type { Node } from "@xyflow/react";

import {
  SCRIPT_BUTTON_NODE_TYPE,
  nodeToScriptButton,
  scriptButtonToNode
} from "../annotations/annotationNodeConverters";
import type { ScriptButtonNodeData } from "../components/canvas/types";
import type { GroupStyleAnnotation, ScriptButtonAnnotation } from "../core/types/topology";
import { useClabUiHost } from "../host";
import { hostScriptUnavailableMessage, type LabHostScriptDescription } from "../host/labOperations";
import { findDeepestGroupAtPosition } from "../hooks/canvas/groupUtils";
import type { TopologySessionClient } from "../session";
import { saveAnnotationNodesFromGraph } from "../services";
import { useAnnotationUIStore } from "../stores/annotationUIStore";
import { useGraphStore } from "../stores/graphStore";
import { useLabOperationsStore } from "../stores/labOperationsStore";

import { needsConfirmation, resolveScriptButtonConfirm, trustScript } from "./scriptButtonPolicy";
import { scriptRunKey, useScriptButtonStore } from "./scriptButtonStore";

type ToastType = "info" | "success" | "warning" | "error";

/** How long the success or failure ring stays on a button after a run. */
const STATUS_LINGER_MS = 4000;

interface UseScriptButtonsParams {
  isLocked: boolean;
  onLockedAction: () => void;
  sessionClient: TopologySessionClient;
  /** The canvas groups, read when a button is created to find its parent group. */
  getGroups: () => GroupStyleAnnotation[];
  addToast: (message: string, type?: ToastType, duration?: number) => void;
}

export interface ScriptButtonActions {
  createScriptButtonAtPosition: (position: { x: number; y: number }) => void;
  editScriptButton: (id: string) => void;
  deleteScriptButton: (id: string) => void;
  runScriptButton: (id: string) => void;
  stopScriptButton: (id: string) => void;
}

function isScriptButtonNode(node: Node): node is Node<ScriptButtonNodeData> {
  return node.type === SCRIPT_BUTTON_NODE_TYPE;
}

export function findScriptButton(id: string): ScriptButtonAnnotation | undefined {
  const node = useGraphStore.getState().nodes.find((entry) => entry.id === id);
  return node && isScriptButtonNode(node) ? nodeToScriptButton(node) : undefined;
}

/** Merges changes into a script button on the canvas; false when it is gone. */
export function updateScriptButtonNode(id: string, updates: Partial<ScriptButtonAnnotation>): boolean {
  const current = findScriptButton(id);
  if (!current) return false;
  useGraphStore.getState().replaceNode(id, scriptButtonToNode({ ...current, ...updates, id }));
  return true;
}

function nextScriptButtonId(nodes: Node[]): string {
  const used = new Set(nodes.map((node) => node.id));
  let index = nodes.filter(isScriptButtonNode).length + 1;
  while (used.has(`script-button-${index}`)) index += 1;
  return `script-button-${index}`;
}

function describeResult(
  label: string,
  result: { exitCode: number | null; timedOut: boolean; cancelled?: boolean }
): { message: string; type: ToastType } {
  if (result.cancelled === true) return { message: `${label} stopped.`, type: "info" };
  if (result.timedOut) return { message: `${label} timed out.`, type: "error" };
  if (result.exitCode === 0) return { message: `${label} finished.`, type: "success" };
  return { message: `${label} exited with ${result.exitCode ?? "a signal"}.`, type: "error" };
}

/** Script buttons on the canvas: create, edit and delete them, and run their scripts. */
export function useScriptButtons(params: UseScriptButtonsParams): ScriptButtonActions {
  const { isLocked, onLockedAction, sessionClient, getGroups, addToast } = params;
  const operations = useClabUiHost().topoViewer.labOperations;

  const persist = useCallback(() => {
    void saveAnnotationNodesFromGraph(sessionClient);
  }, [sessionClient]);

  const createScriptButtonAtPosition = useCallback(
    (position: { x: number; y: number }) => {
      if (isLocked) {
        onLockedAction();
        return;
      }
      const graph = useGraphStore.getState();
      const annotation: ScriptButtonAnnotation = {
        id: nextScriptButtonId(graph.nodes),
        label: "Run script",
        position,
        output: "terminal",
        groupId: findDeepestGroupAtPosition(position, getGroups())?.id
      };
      graph.addNode(scriptButtonToNode(annotation));
      persist();
      useAnnotationUIStore.getState().setEditingScriptButtonId(annotation.id);
    },
    [isLocked, onLockedAction, getGroups, persist]
  );

  const editScriptButton = useCallback((id: string) => {
    if (findScriptButton(id)) useAnnotationUIStore.getState().setEditingScriptButtonId(id);
  }, []);

  const deleteScriptButton = useCallback(
    (id: string) => {
      if (isLocked) {
        onLockedAction();
        return;
      }
      useGraphStore.getState().removeNode(id);
      const ui = useAnnotationUIStore.getState();
      if (ui.editingScriptButtonId === id) ui.closeScriptButtonEditor();
      persist();
    },
    [isLocked, onLockedAction, persist]
  );

  /** Buttons between the click and the start of their run, so a double click runs once. */
  const preparing = useRef(new Set<string>());

  // Running is not editing, so it works in view mode and while the lab is locked.
  const runScriptButton = useCallback(
    (id: string) => {
      const button = findScriptButton(id);
      if (!button) return;
      const store = useScriptButtonStore.getState();
      const key = scriptRunKey(id);
      if (store.status[key] === "running" || preparing.current.has(key)) return;
      const label = button.label.trim() || "Script";
      const scriptPath = button.scriptPath?.trim() ?? "";
      const script = button.script ?? "";
      if (!operations) {
        addToast("Script buttons need a lab host to run.", "warning");
        return;
      }
      const { support } = useLabOperationsStore.getState();
      if (!support.hostScript) {
        addToast(hostScriptUnavailableMessage(support.hostScriptUnavailable), "warning");
        return;
      }
      if (scriptPath === "" && script.trim() === "") {
        addToast(`${label} has no script yet. Edit it to add one.`, "warning");
        return;
      }

      const source = scriptPath !== "" ? { scriptPath } : { script };
      preparing.current.add(key);
      void (async () => {
        let description: LabHostScriptDescription;
        try {
          description = await operations.describeHostScript(source);
          if (needsConfirmation(resolveScriptButtonConfirm(), description)) {
            const confirmed = await store.askConfirm({ label, script: description });
            if (!confirmed) return;
            trustScript(description.trustKey);
          }
        } catch (error) {
          addToast(`${label}: ${error instanceof Error ? error.message : String(error)}`, "error");
          return;
        } finally {
          preparing.current.delete(key);
        }

        const status = useScriptButtonStore.getState();
        const controller = new AbortController();
        status.setStatus(key, "running");
        status.setStop(key, () => controller.abort());
        try {
          const result = await operations.runHostScript(
            {
              ...source,
              expectedSha256: description.sha256,
              ...(button.timeoutSeconds !== undefined ? { timeoutSeconds: button.timeoutSeconds } : {}),
              ...(button.output === undefined || button.output === "terminal" ? { outputTitle: label } : {})
            },
            { signal: controller.signal }
          );
          const outcome = describeResult(label, result);
          if (result.cancelled === true) status.setStatus(key, undefined);
          else status.setStatus(key, outcome.type === "success" ? "success" : "failed");
          if (button.output === "dialog" && result.cancelled !== true) status.showOutput(label, result);
          else if (button.output === "toast" || result.cancelled === true) addToast(outcome.message, outcome.type);
        } catch (error) {
          status.setStatus(key, "failed");
          addToast(`${label}: ${error instanceof Error ? error.message : String(error)}`, "error");
        } finally {
          status.setStop(key, undefined);
        }
        setTimeout(() => {
          if (useScriptButtonStore.getState().status[key] !== "running") {
            useScriptButtonStore.getState().setStatus(key, undefined);
          }
        }, STATUS_LINGER_MS);
      })();
    },
    [operations, addToast]
  );

  const stopScriptButton = useCallback((id: string) => {
    useScriptButtonStore.getState().stops[scriptRunKey(id)]?.();
  }, []);

  return useMemo(
    () => ({
      createScriptButtonAtPosition,
      editScriptButton,
      deleteScriptButton,
      runScriptButton,
      stopScriptButton
    }),
    [createScriptButtonAtPosition, editScriptButton, deleteScriptButton, runScriptButton, stopScriptButton]
  );
}
