import { useCallback, useMemo, useRef } from "react";

import type { FreeTextAnnotation } from "../../core/types/topology";
import type { TopologySessionClient } from "../../session";
import type { AnnotationUIActions, AnnotationUIState } from "../../stores/annotationUIStore";
import { saveAnnotationNodesFromGraph } from "../../services";
import { log } from "../../utils/logger";

import type { UseDerivedAnnotationsReturn } from "./useDerivedAnnotations";
import { cloneFreeTextAnnotation } from "./cloneFreeTextAnnotation";
import { findDeepestGroupAtPosition } from "./groupUtils";
import { readThemeColor } from "./themeColor";

interface UseTextAnnotationsParams {
  isLocked: boolean;
  onLockedAction: () => void;
  derived: UseDerivedAnnotationsReturn;
  sessionClient: TopologySessionClient;
  /** Debounced whole-graph persist shared across annotation kinds (live apply). */
  debouncedPersist: () => void;
  uiState: Pick<
    AnnotationUIState,
    "isAddTextMode" | "selectedTextIds" | "inlineEditingTextId" | "editingTextAnnotation"
  >;
  uiActions: Pick<
    AnnotationUIActions,
    | "setAddTextMode"
    | "disableAddTextMode"
    | "setEditingTextAnnotation"
    | "closeTextEditor"
    | "setInlineEditingTextId"
    | "removeFromTextSelection"
  >;
}

export interface TextAnnotationActions {
  handleAddText: () => void;
  createTextAtPosition: (position: { x: number; y: number }) => void;
  editTextAnnotation: (id: string) => void;
  editTextWithInline: (id: string) => void;
  saveTextAnnotation: (annotation: FreeTextAnnotation) => void;
  applyTextAnnotationEdit: (annotation: FreeTextAnnotation) => void;
  startInlineTextEdit: (id: string) => void;
  commitInlineTextEdit: (id: string, text: string) => void;
  openInlineTextStyleEditor: (id: string, text: string) => void;
  updateTextStyle: (id: string, style: Partial<FreeTextAnnotation>) => void;
  duplicateTextAnnotation: (id: string) => void;
  deleteTextAnnotation: (id: string) => void;
  deleteSelectedTextAnnotations: () => void;
  onTextRotationStart: (id: string) => void;
  onTextRotationEnd: (id: string) => void;
  handleTextCanvasClick: (position: { x: number; y: number }) => void;
}

/** Fields the text editor form / inline toolbar may change. Layout fields
 * (position, size, group membership, geo) stay canvas-authoritative. */
function pickTextEditableFields(annotation: FreeTextAnnotation): Partial<FreeTextAnnotation> {
  return {
    text: annotation.text,
    fontSize: annotation.fontSize,
    fontColor: annotation.fontColor,
    backgroundColor: annotation.backgroundColor,
    fontWeight: annotation.fontWeight,
    fontStyle: annotation.fontStyle,
    textDecoration: annotation.textDecoration,
    textAlign: annotation.textAlign,
    fontFamily: annotation.fontFamily,
    rotation: annotation.rotation
  };
}

function pickTextStyleMemory(annotation: Partial<FreeTextAnnotation>): Partial<FreeTextAnnotation> {
  const memory: Partial<FreeTextAnnotation> = {};
  if ("fontSize" in annotation) memory.fontSize = annotation.fontSize;
  if ("fontColor" in annotation) memory.fontColor = annotation.fontColor;
  if ("backgroundColor" in annotation) memory.backgroundColor = annotation.backgroundColor;
  if ("fontWeight" in annotation) memory.fontWeight = annotation.fontWeight;
  if ("fontStyle" in annotation) memory.fontStyle = annotation.fontStyle;
  if ("textDecoration" in annotation) memory.textDecoration = annotation.textDecoration;
  if ("textAlign" in annotation) memory.textAlign = annotation.textAlign;
  if ("fontFamily" in annotation) memory.fontFamily = annotation.fontFamily;
  return memory;
}

export function useTextAnnotations(params: UseTextAnnotationsParams): TextAnnotationActions {
  const { isLocked, onLockedAction, derived, sessionClient, debouncedPersist, uiState, uiActions } =
    params;
  const canEditAnnotations = !isLocked;

  const lastTextStyleRef = useRef<Partial<FreeTextAnnotation>>({});
  const pendingRotationRef = useRef<string | null>(null);

  const buildTextAnnotation = useCallback(
    (position: { x: number; y: number }): FreeTextAnnotation => {
      const parentGroup = findDeepestGroupAtPosition(position, derived.groups);
      return {
        id: `freeText_${Date.now()}`,
        text: "",
        position,
        fontSize: lastTextStyleRef.current.fontSize ?? 14,
        fontColor:
          lastTextStyleRef.current.fontColor ??
          readThemeColor("--vscode-editor-foreground", "#333333"),
        backgroundColor: lastTextStyleRef.current.backgroundColor,
        fontWeight: lastTextStyleRef.current.fontWeight ?? "normal",
        fontStyle: lastTextStyleRef.current.fontStyle ?? "normal",
        textDecoration: lastTextStyleRef.current.textDecoration ?? "none",
        textAlign: lastTextStyleRef.current.textAlign ?? "left",
        fontFamily: lastTextStyleRef.current.fontFamily ?? "Arial",
        groupId: parentGroup?.id
      };
    },
    [derived.groups]
  );

  // New annotations are edited inline on the canvas: add them to the graph
  // right away (persisted on first non-empty commit) and focus the inline editor.
  const startTextEditingAtPosition = useCallback(
    (position: { x: number; y: number }) => {
      const newAnnotation = buildTextAnnotation(position);
      derived.addTextAnnotation(newAnnotation);
      uiActions.closeTextEditor();
      uiActions.setInlineEditingTextId(newAnnotation.id);
      uiActions.disableAddTextMode();
      log.info(`[FreeText] Creating annotation at (${position.x}, ${position.y})`);
    },
    [buildTextAnnotation, derived, uiActions]
  );

  const handleAddText = useCallback(() => {
    if (!canEditAnnotations) {
      onLockedAction();
      return;
    }
    uiActions.setAddTextMode(true);
  }, [canEditAnnotations, onLockedAction, uiActions]);

  const createTextAtPosition = useCallback(
    (position: { x: number; y: number }) => {
      if (!canEditAnnotations) {
        onLockedAction();
        return;
      }
      startTextEditingAtPosition(position);
    },
    [canEditAnnotations, onLockedAction, startTextEditingAtPosition]
  );

  const editTextAnnotation = useCallback(
    (id: string) => {
      // The inline editor owns this annotation; a stale panel snapshot would
      // clobber its edits (click events may arrive after the double-click).
      if (uiState.inlineEditingTextId === id) return;
      const annotation = derived.textAnnotations.find((a) => a.id === id);
      if (annotation) {
        uiActions.setEditingTextAnnotation(annotation);
      }
    },
    [derived.textAnnotations, uiActions, uiState.inlineEditingTextId]
  );

  /** Context-menu "Edit Text": open the style drawer and the inline editor
   * together, so the user can type on the canvas and style in the drawer. */
  const editTextWithInline = useCallback(
    (id: string) => {
      if (!canEditAnnotations) {
        onLockedAction();
        return;
      }
      const annotation = derived.textAnnotations.find((a) => a.id === id);
      if (!annotation) return;
      uiActions.setEditingTextAnnotation(annotation);
      uiActions.setInlineEditingTextId(id);
    },
    [canEditAnnotations, onLockedAction, derived.textAnnotations, uiActions]
  );

  const persist = useCallback(() => {
    void saveAnnotationNodesFromGraph(sessionClient);
  }, [sessionClient]);

  const persistQuiet = useCallback(() => {
    void saveAnnotationNodesFromGraph(sessionClient, undefined, { applySnapshot: false });
  }, [sessionClient]);

  const rememberTextStyle = useCallback((annotation: Partial<FreeTextAnnotation>) => {
    lastTextStyleRef.current = {
      ...lastTextStyleRef.current,
      ...pickTextStyleMemory(annotation)
    };
  }, []);

  const saveTextAnnotation = useCallback(
    (annotation: FreeTextAnnotation) => {
      const isNew = !derived.textAnnotations.some((t) => t.id === annotation.id);

      if (isNew) {
        derived.addTextAnnotation(annotation);
      } else {
        derived.updateTextAnnotation(annotation.id, annotation);
      }

      rememberTextStyle(annotation);
      persist();
    },
    [derived, persist, rememberTextStyle]
  );

  /** Live apply from the text editor panel: merge editable fields and persist debounced. */
  const applyTextAnnotationEdit = useCallback(
    (annotation: FreeTextAnnotation) => {
      if (!derived.textAnnotations.some((t) => t.id === annotation.id)) return;
      derived.updateTextAnnotation(annotation.id, pickTextEditableFields(annotation));
      rememberTextStyle(annotation);
      debouncedPersist();
    },
    [derived, rememberTextStyle, debouncedPersist]
  );

  const startInlineTextEdit = useCallback(
    (id: string) => {
      if (!canEditAnnotations) {
        onLockedAction();
        return;
      }
      if (!derived.textAnnotations.some((a) => a.id === id)) return;
      // The panel editor holds a snapshot; close it so it can't clobber inline edits.
      uiActions.closeTextEditor();
      uiActions.setInlineEditingTextId(id);
    },
    [canEditAnnotations, onLockedAction, derived.textAnnotations, uiActions]
  );

  const commitInlineTextEdit = useCallback(
    (id: string, text: string) => {
      uiActions.setInlineEditingTextId(null);
      const annotation = derived.textAnnotations.find((a) => a.id === id);
      if (!annotation) return null;
      const drawerOpenForId = uiState.editingTextAnnotation?.id === id;

      if (text.trim().length === 0) {
        // Empty text annotations are never persisted, so only write the
        // deletion when a previously saved annotation was emptied.
        const wasPersisted = annotation.text.trim().length > 0;
        derived.deleteTextAnnotation(id);
        uiActions.removeFromTextSelection(id);
        if (drawerOpenForId) uiActions.closeTextEditor();
        if (wasPersisted) persist();
        return null;
      }

      if (annotation.text === text) return annotation;

      const nextAnnotation = { ...annotation, text };
      derived.updateTextAnnotation(id, { text });
      // An open style drawer must pick up the committed text, or its next
      // live-apply would write the stale snapshot back.
      if (drawerOpenForId) uiActions.setEditingTextAnnotation(nextAnnotation);
      rememberTextStyle(nextAnnotation);
      debouncedPersist();
      return nextAnnotation;
    },
    [derived, uiActions, persist, rememberTextStyle, debouncedPersist, uiState.editingTextAnnotation]
  );

  /** Inline-toolbar "More styling options": open the style drawer next to the
   * inline editor. Editing continues inline; commits keep the drawer synced. */
  const openInlineTextStyleEditor = useCallback(
    (id: string, text: string) => {
      if (text.trim().length === 0) {
        // Emptied annotations are deleted on commit; there is nothing to style.
        commitInlineTextEdit(id, text);
        return;
      }
      const annotation = derived.textAnnotations.find((a) => a.id === id);
      if (!annotation) return;
      uiActions.setEditingTextAnnotation({ ...annotation, text });
    },
    [commitInlineTextEdit, derived.textAnnotations, uiActions]
  );

  /** Live style change from the inline formatting toolbar. */
  const updateTextStyle = useCallback(
    (id: string, style: Partial<FreeTextAnnotation>) => {
      const annotation = derived.textAnnotations.find((a) => a.id === id);
      if (!annotation) return;
      derived.updateTextAnnotation(id, style);
      // Keep an open style drawer in sync with inline-toolbar changes. The
      // drawer snapshot may hold newer (uncommitted) text — preserve it.
      const drawer = uiState.editingTextAnnotation;
      if (drawer?.id === id) {
        uiActions.setEditingTextAnnotation({ ...annotation, text: drawer.text, ...style });
      }
      rememberTextStyle(style);
      // Not-yet-committed annotations (empty text) persist on inline commit instead.
      if (annotation.text.trim().length > 0) debouncedPersist();
    },
    [derived, uiActions, rememberTextStyle, debouncedPersist, uiState.editingTextAnnotation]
  );

  const duplicateTextAnnotation = useCallback(
    (id: string) => {
      const annotation = derived.textAnnotations.find((a) => a.id === id);
      if (!annotation) return;
      derived.addTextAnnotation(cloneFreeTextAnnotation(annotation, `freeText_${Date.now()}`));
      persist();
    },
    [derived, persist]
  );

  const deleteTextAnnotation = useCallback(
    (id: string) => {
      derived.deleteTextAnnotation(id);
      uiActions.removeFromTextSelection(id);
      if (uiState.inlineEditingTextId === id) {
        uiActions.setInlineEditingTextId(null);
      }
      persist();
    },
    [derived, uiActions, persist, uiState.inlineEditingTextId]
  );

  const deleteSelectedTextAnnotations = useCallback(() => {
    const ids = Array.from(uiState.selectedTextIds);
    if (ids.length === 0) return;
    ids.forEach((id) => {
      derived.deleteTextAnnotation(id);
      uiActions.removeFromTextSelection(id);
    });
    persist();
  }, [derived, uiActions, persist, uiState.selectedTextIds]);

  const onTextRotationStart = useCallback((id: string) => {
    pendingRotationRef.current = id;
  }, []);

  const onTextRotationEnd = useCallback(
    (id: string) => {
      if (pendingRotationRef.current === id) {
        pendingRotationRef.current = null;
        persistQuiet();
      }
    },
    [persistQuiet]
  );

  const handleTextCanvasClick = useCallback(
    (position: { x: number; y: number }) => {
      if (!uiState.isAddTextMode) return;
      startTextEditingAtPosition(position);
    },
    [uiState.isAddTextMode, startTextEditingAtPosition]
  );

  return useMemo(
    () => ({
      handleAddText,
      createTextAtPosition,
      editTextAnnotation,
      editTextWithInline,
      saveTextAnnotation,
      applyTextAnnotationEdit,
      startInlineTextEdit,
      commitInlineTextEdit,
      openInlineTextStyleEditor,
      updateTextStyle,
      duplicateTextAnnotation,
      deleteTextAnnotation,
      deleteSelectedTextAnnotations,
      onTextRotationStart,
      onTextRotationEnd,
      handleTextCanvasClick
    }),
    [
      handleAddText,
      createTextAtPosition,
      editTextAnnotation,
      editTextWithInline,
      saveTextAnnotation,
      applyTextAnnotationEdit,
      startInlineTextEdit,
      commitInlineTextEdit,
      openInlineTextStyleEditor,
      updateTextStyle,
      duplicateTextAnnotation,
      deleteTextAnnotation,
      deleteSelectedTextAnnotations,
      onTextRotationStart,
      onTextRotationEnd,
      handleTextCanvasClick
    ]
  );
}
