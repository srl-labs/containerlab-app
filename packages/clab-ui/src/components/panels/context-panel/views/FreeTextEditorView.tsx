// Text annotation editor for the ContextPanel.
import React, { useMemo } from "react";
import type { Node } from "@xyflow/react";

import type { FreeTextAnnotation } from "../../../../core/types/topology";
import {
  nodeToFreeText,
  FREE_TEXT_NODE_TYPE
} from "../../../../annotations/annotationNodeConverters";
import { useAnnotationUIStore } from "../../../../stores/annotationUIStore";
import { useGraphStore } from "../../../../stores/graphStore";
import type { FreeTextNodeData } from "../../../canvas/types";
import { FreeTextFormContent } from "../../free-text-editor/FreeTextFormContent";

import {
  AnnotationFormEditorView,
  type AnnotationEditorViewProps
} from "./AnnotationFormEditorView";

export type FreeTextEditorViewProps = AnnotationEditorViewProps<FreeTextAnnotation>;

function canApply(data: FreeTextAnnotation): boolean {
  return data.text.trim().length > 0;
}

function cloneAnnotation(annotation: FreeTextAnnotation): FreeTextAnnotation {
  return { ...annotation };
}

export const FreeTextEditorView: React.FC<FreeTextEditorViewProps> = (props) => {
  const node = useGraphStore((state) =>
    state.nodes.find(
      (entry): entry is Node<FreeTextNodeData> =>
        entry.id === props.annotation?.id && entry.type === FREE_TEXT_NODE_TYPE
    )
  );
  const inlineEditing = useAnnotationUIStore(
    (state) => state.inlineEditingTextId === props.annotation?.id
  );
  const annotation = useMemo(() => {
    if (!node) return props.annotation;
    const current = nodeToFreeText(node);
    // The inline editor can open the drawer with text that is not committed yet.
    return inlineEditing && props.annotation
      ? { ...current, text: props.annotation.text }
      : current;
  }, [node, props.annotation, inlineEditing]);
  return (
    <AnnotationFormEditorView
      {...props}
      annotation={annotation}
      FormContent={FreeTextFormContent}
      snapshot={cloneAnnotation}
      canApply={canApply}
    />
  );
};
