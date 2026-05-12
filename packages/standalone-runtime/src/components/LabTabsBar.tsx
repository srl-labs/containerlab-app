import React from "react";

import type { LabTab } from "../stores/labTabsStore";

interface LabTabsBarProps {
  activeTabId: string | null;
  endpointLabels: ReadonlyMap<string, string>;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  tabs: LabTab[];
}

const BASE_BORDER_COLOR = "var(--vscode-panel-border, rgba(128, 128, 128, 0.35))";
const ACTIVE_BG = "var(--vscode-tab-activeBackground, #1e1e1e)";
const ACTIVE_FG = "var(--vscode-tab-activeForeground, #ffffff)";
const INACTIVE_BG = "var(--vscode-tab-inactiveBackground, #2d2d2d)";
const INACTIVE_FG = "var(--vscode-tab-inactiveForeground, rgba(255, 255, 255, 0.72))";
const HOVER_BG = "var(--vscode-tab-hoverBackground, #2a2d2e)";
const ACTIVE_BORDER = "var(--vscode-tab-activeBorderTop, #007fd4)";
const TAB_BAR_HEIGHT = 45;

function endpointBadgeLabel(endpointId: string, endpointLabels: ReadonlyMap<string, string>): string {
  return endpointLabels.get(endpointId) ?? endpointId;
}

export function LabTabsBar({
  activeTabId,
  endpointLabels,
  onActivate,
  onClose,
  tabs
}: LabTabsBarProps): React.JSX.Element | null {
  if (tabs.length === 0) {
    return null;
  }

  return (
    <div
      role="tablist"
      aria-label="Open lab tabs"
      data-testid="lab-tabs"
      style={{
        display: "flex",
        alignItems: "stretch",
        width: "100%",
        height: TAB_BAR_HEIGHT,
        boxSizing: "border-box",
        borderBottom: `1px solid ${BASE_BORDER_COLOR}`,
        overflowX: "auto",
        overflowY: "hidden",
        backgroundColor: INACTIVE_BG
      }}
    >
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const endpointLabel = endpointBadgeLabel(tab.endpointId, endpointLabels);
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            data-testid={`lab-tab-${tab.id}`}
            onClick={() => onActivate(tab.id)}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                onClose(tab.id);
              }
            }}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 150,
              maxWidth: 300,
              padding: "0 10px",
              borderRight: `1px solid ${BASE_BORDER_COLOR}`,
              borderTop: active ? `2px solid ${ACTIVE_BORDER}` : "2px solid transparent",
              backgroundColor: active ? ACTIVE_BG : INACTIVE_BG,
              color: active ? ACTIVE_FG : INACTIVE_FG,
              cursor: "pointer",
              userSelect: "none",
              flexShrink: 0
            }}
            title={tab.topologyRef.yamlPath}
            onMouseEnter={(event) => {
              if (!active) {
                event.currentTarget.style.backgroundColor = HOVER_BG;
              }
            }}
            onMouseLeave={(event) => {
              if (!active) {
                event.currentTarget.style.backgroundColor = INACTIVE_BG;
              }
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flexGrow: 1
              }}
            >
              {tab.title}
            </span>
            <span
              style={{
                fontSize: 10,
                lineHeight: "14px",
                padding: "0 4px",
                borderRadius: 4,
                border: `1px solid ${BASE_BORDER_COLOR}`,
                opacity: 0.85,
                whiteSpace: "nowrap"
              }}
            >
              {endpointLabel}
            </span>
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              data-testid={`lab-tab-close-${tab.id}`}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.id);
              }}
              style={{
                width: 18,
                height: 18,
                border: "none",
                borderRadius: 4,
                padding: 0,
                color: active ? ACTIVE_FG : INACTIVE_FG,
                backgroundColor: "transparent",
                cursor: "pointer",
                flexShrink: 0
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.backgroundColor = HOVER_BG;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              x
            </button>
          </div>
        );
      })}
    </div>
  );
}
