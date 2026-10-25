import { useCallback, useMemo } from "react";
import type { Node } from "@xyflow/react";

import {
  SCRIPT_BUTTON_NODE_TYPE,
  nodeToScriptButton,
  scriptButtonToNode
} from "../annotations/annotationNodeConverters";
import type { ScriptButtonNodeData } from "../components/canvas/types";
import type { GroupStyleAnnotation, ScriptButtonAnnotation } from "../core/types/topology";
import { useClabUiHost } from "../host";
import { findDeepestGroupAtPosition } from "../hooks/canvas/groupUtils";
import type { TopologySessionClient } from "../session";
import { saveAnnotationNodesFromGraph } from "../services";
import { useAnnotationUIStore } from "../stores/annotationUIStore";
import { useGraphStore } from "../stores/graphStore";
import { useLabOperationsStore } from "../stores/labOperationsStore";
import { useTopoViewerStore } from "../stores/topoViewerStore";

import { needsConfirmation, resolveScriptButtonConfirm, scriptTrustKey, trustScript } from "./scriptButtonPolicy";
import { useScriptButtonStore } from "./scriptButtonStore";

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
  /** Merges editor changes into the button and saves them. */
  updateScriptButton: (id: string, updates: Partial<ScriptButtonAnnotation>) => void;
  deleteScriptButton: (id: string) => void;
  runScriptButton: (id: string) => void;
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
  result: { exitCode: number | null; timedOut: boolean }
): { message: string; type: ToastType } {
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

  const updateScriptButton = useCallback(
    (id: string, updates: Partial<ScriptButtonAnnotation>) => {
      if (updateScriptButtonNode(id, updates)) persist();
    },
    [persist]
  );

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

  // Running is not editing, so it works in view mode and while the lab is locked.
  const runScriptButton = useCallback(
    (id: string) => {
      const button = findScriptButton(id);
      if (!button) return;
      const store = useScriptButtonStore.getState();
      if (store.status[id] === "running") return;
      const label = button.label.trim() || "Script";
      const scriptPath = button.scriptPath?.trim() ?? "";
      const script = button.script ?? "";
      if (!operations) {
        addToast("Script buttons need a lab host to run.", "warning");
        return;
      }
      if (!useLabOperationsStore.getState().support.hostScript) {
        addToast("This lab host cannot run scripts. Use a local lab or update clab-api-server.", "warning");
        return;
      }
      if (scriptPath === "" && script.trim() === "") {
        addToast(`${label} has no script yet. Edit it to add one.`, "warning");
        return;
      }

      const source = scriptPath !== "" ? scriptPath : script;
      const viewer = useTopoViewerStore.getState();
      const trustKey = scriptTrustKey(`${viewer.labName}|${viewer.yamlFileName}`, source);
      void (async () => {
        if (needsConfirmation(resolveScriptButtonConfirm(), trustKey)) {
          const confirmed = await store.askConfirm({ label, source, isPath: scriptPath !== "" });
          if (!confirmed) return;
          trustScript(trustKey);
        }
        const status = useScriptButtonStore.getState();
        status.setStatus(id, "running");
        try {
          const result = await operations.runHostScript({
            ...(scriptPath !== "" ? { scriptPath } : { script }),
            ...(button.timeoutSeconds !== undefined ? { timeoutSeconds: button.timeoutSeconds } : {}),
            ...(button.output === undefined || button.output === "terminal" ? { outputTitle: label } : {})
          });
          const outcome = describeResult(label, result);
          status.setStatus(id, outcome.type === "success" ? "success" : "failed");
          if (button.output === "dialog") status.showOutput(label, result);
          else if (button.output === "toast") addToast(outcome.message, outcome.type);
        } catch (error) {
          status.setStatus(id, "failed");
          addToast(`${label}: ${error instanceof Error ? error.message : String(error)}`, "error");
        }
        setTimeout(() => {
          if (useScriptButtonStore.getState().status[id] !== "running") {
            useScriptButtonStore.getState().setStatus(id, undefined);
          }
        }, STATUS_LINGER_MS);
      })();
    },
    [operations, addToast]
  );

  return useMemo(
    () => ({
      createScriptButtonAtPosition,
      editScriptButton,
      updateScriptButton,
      deleteScriptButton,
      runScriptButton
    }),
    [createScriptButtonAtPosition, editScriptButton, updateScriptButton, deleteScriptButton, runScriptButton]
  );
}
