// Shape annotation editor for the ContextPanel.
import React, { useMemo } from "react";
import type { Node } from "@xyflow/react";

import type { FreeShapeAnnotation } from "../../../../core/types/topology";
import { normalizeShapeAnnotationColors } from "../../../../utils/color";
import { getShapeRotation } from "../../../../annotations/rotation";
import {
  nodeToFreeShape,
  FREE_SHAPE_NODE_TYPE
} from "../../../../annotations/annotationNodeConverters";
import { useGraphStore } from "../../../../stores/graphStore";
import type { FreeShapeNodeData } from "../../../canvas/types";
import { FreeShapeFormContent } from "../../free-shape-editor/FreeShapeFormContent";

import {
  AnnotationFormEditorView,
  type AnnotationEditorViewProps
} from "./AnnotationFormEditorView";

export type FreeShapeEditorViewProps = AnnotationEditorViewProps<FreeShapeAnnotation>;

function normalizeShapeForEditor(annotation: FreeShapeAnnotation): FreeShapeAnnotation {
  return {
    ...normalizeShapeAnnotationColors(annotation),
    rotation: getShapeRotation(annotation)
  };
}

export const FreeShapeEditorView: React.FC<FreeShapeEditorViewProps> = (props) => {
  const node = useGraphStore((state) =>
    state.nodes.find(
      (entry): entry is Node<FreeShapeNodeData> =>
        entry.id === props.annotation?.id && entry.type === FREE_SHAPE_NODE_TYPE
    )
  );
  const annotation = useMemo(
    () => (node ? normalizeShapeForEditor(nodeToFreeShape(node)) : props.annotation),
    [node, props.annotation]
  );
  return (
    <AnnotationFormEditorView
      {...props}
      annotation={annotation}
      FormContent={FreeShapeFormContent}
      snapshot={normalizeShapeAnnotationColors}
      transformData={normalizeShapeAnnotationColors}
    />
  );
};
