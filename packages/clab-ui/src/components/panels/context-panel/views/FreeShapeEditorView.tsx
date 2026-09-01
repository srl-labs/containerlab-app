// Shape annotation editor for the ContextPanel.
import React from "react";

import type { FreeShapeAnnotation } from "../../../../core/types/topology";
import { normalizeShapeAnnotationColors } from "../../../../utils/color";
import { FreeShapeFormContent } from "../../free-shape-editor/FreeShapeFormContent";

import { AnnotationFormEditorView, type AnnotationEditorViewProps } from "./AnnotationFormEditorView";

export type FreeShapeEditorViewProps = AnnotationEditorViewProps<FreeShapeAnnotation>;

export const FreeShapeEditorView: React.FC<FreeShapeEditorViewProps> = (props) => (
  <AnnotationFormEditorView
    {...props}
    FormContent={FreeShapeFormContent}
    snapshot={normalizeShapeAnnotationColors}
    transformData={normalizeShapeAnnotationColors}
  />
);
