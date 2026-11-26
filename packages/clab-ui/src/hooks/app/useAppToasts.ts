/**
 * useAppToasts - app-level toast wiring.
 */
import { useEffect } from "react";

import { useToasts } from "../../components/ui/Toast";
import { templateProblem } from "../../components/navbar/templateNotice";
import { useTopoViewerStore } from "../../stores/topoViewerStore";

import { useCustomNodeErrorToast } from "./useAppContentHelpers";

interface AppToastsParams {
  customNodeError: string | null;
  clearCustomNodeError: () => void;
}

const TEMPLATE_PROBLEM_TOAST_MS = 10_000;

/**
 * Says why a template does not show as containerlab deploys it, once per
 * reason: the toolbar's template chip keeps it afterwards.
 */
function useTemplateProblemToast(addToast: ReturnType<typeof useToasts>["addToast"]): void {
  const problem = useTopoViewerStore((state) =>
    state.topologyTemplate
      ? templateProblem(state.topologyTemplate, state.yamlFileName)
      : undefined
  );
  useEffect(() => {
    if (problem) addToast(problem, "warning", TEMPLATE_PROBLEM_TOAST_MS);
  }, [problem, addToast]);
}

export function useAppToasts({ customNodeError, clearCustomNodeError }: AppToastsParams) {
  const { toasts, addToast, dismissToast } = useToasts();

  useCustomNodeErrorToast(customNodeError, addToast, clearCustomNodeError);
  useTemplateProblemToast(addToast);

  return { toasts, dismissToast, addToast };
}
