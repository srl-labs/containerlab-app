import React, { memo, useCallback } from "react";
import type { NodeProps } from "@xyflow/react";
import CircularProgress from "@mui/material/CircularProgress";

import type { ScriptButtonNodeData } from "../types";
import { SELECTION_COLOR } from "../types";
import { useAnnotationHandlers } from "../../../stores/canvasStore";
import { useScriptButtonStore } from "../../../scriptButtons/scriptButtonStore";
import { scriptButtonIcon } from "../../../scriptButtons/scriptButtonIcons";

const STATUS_COLORS = {
  success: "var(--vscode-testing-iconPassed, #3fb950)",
  failed: "var(--vscode-errorForeground, #f85149)"
} as const;

/**
 * A button on the canvas that runs a script on the lab host. The round run
 * control runs it; the rest of the pill drags, selects and opens the editor.
 */
const ScriptButtonNodeComponent: React.FC<NodeProps> = ({ id, data, selected }) => {
  const nodeData = data as ScriptButtonNodeData;
  const handlers = useAnnotationHandlers();
  const status = useScriptButtonStore((state) => state.status[id]);
  const running = status === "running";
  const accent = nodeData.color ?? "var(--vscode-button-background, #0e639c)";
  const label = nodeData.label.trim() || "Run script";
  const Icon = scriptButtonIcon(nodeData.icon);
  const ringColor =
    status === "success" || status === "failed" ? STATUS_COLORS[status] : "var(--vscode-panel-border, #3f3f46)";
  const handleRun = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      handlers?.onRunScriptButton?.(id);
    },
    [handlers, id]
  );
  // A double-click on the run control must not open the editor too.
  const stopDoubleClick = useCallback((event: React.MouseEvent) => event.stopPropagation(), []);

  return (
    <div
      data-testid={`script-button-${id}`}
      title={nodeData.scriptPath ?? "Inline script"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "4px 12px 4px 4px",
        borderRadius: 999,
        background: "var(--vscode-editorWidget-background, #252526)",
        border: `1px solid ${ringColor}`,
        boxShadow: selected ? `0 0 0 2px ${SELECTION_COLOR}` : "0 1px 3px rgba(0, 0, 0, 0.25)",
        color: "var(--vscode-foreground, #cccccc)",
        fontSize: 13,
        fontWeight: 500,
        whiteSpace: "nowrap",
        userSelect: "none",
        transition: "border-color 160ms ease"
      }}
    >
      <button
        type="button"
        className="nodrag nopan"
        aria-label={`Run ${label}`}
        data-testid={`script-button-run-${id}`}
        disabled={running}
        onClick={handleRun}
        onDoubleClick={stopDoubleClick}
        style={{
          width: 26,
          height: 26,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          padding: 0,
          border: 0,
          borderRadius: "50%",
          background: accent,
          color: "var(--vscode-button-foreground, #ffffff)",
          cursor: running ? "progress" : "pointer"
        }}
      >
        {running ? (
          <CircularProgress size={14} thickness={5} sx={{ color: "inherit" }} />
        ) : (
          <Icon sx={{ fontSize: 17 }} />
        )}
      </button>
      <span>{label}</span>
    </div>
  );
};

export const ScriptButtonNode = memo(ScriptButtonNodeComponent);
