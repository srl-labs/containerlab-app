// Inline node search that lives in the navbar. Live-filters the canvas (dimming
// non-matching nodes as you type) and fits the viewport to matches on Enter.
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import { ActionIcon, Text, TextInput, Tooltip } from "@mantine/core";
import { IconSearch, IconX } from "@tabler/icons-react";

import type { TopoNode } from "../../core/types/graph";
import { useGraphStore } from "../../stores/graphStore";
import { useTopoViewerStore } from "../../stores/topoViewerStore";
import { isTopoNodeLike } from "../../utils/graphQueryUtils";
import { formatMatchCountText, getCombinedMatches } from "../panels/find-node/findNodeSearchUtils";

export interface NavbarNodeSearchProps {
  rfInstance: ReactFlowInstance | null;
  disabled?: boolean;
}

export const NavbarNodeSearch: React.FC<NavbarNodeSearchProps> = ({
  rfInstance,
  disabled = false
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const matchesRef = useRef<TopoNode[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const setSearchMatchNodeIds = useTopoViewerStore((state) => state.setSearchMatchNodeIds);

  // Live: recompute matches on each keystroke and dim the non-matching nodes.
  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length === 0) {
      matchesRef.current = [];
      setMatchCount(null);
      setSearchMatchNodeIds(null);
      return;
    }

    const currentNodes = rfInstance
      ? rfInstance.getNodes().filter(isTopoNodeLike)
      : useGraphStore.getState().nodes.filter(isTopoNodeLike);
    const matches = getCombinedMatches(currentNodes, term);
    matchesRef.current = matches;
    setMatchCount(matches.length);
    setSearchMatchNodeIds(new Set(matches.map((node) => node.id)));
  }, [searchTerm, rfInstance, setSearchMatchNodeIds]);

  // Clear the canvas dimming when the search unmounts.
  useEffect(() => () => setSearchMatchNodeIds(null), [setSearchMatchNodeIds]);

  const zoomToMatches = useCallback(() => {
    const matches = matchesRef.current;
    if (matches.length === 0 || !rfInstance) return;
    // fitView adds a 10% margin around the matches and caps how far it zooms in,
    // so a single node lands comfortably in view instead of filling the canvas.
    rfInstance
      .fitView({
        nodes: matches.map((node) => ({ id: node.id })),
        padding: "10%",
        maxZoom: 1.5,
        duration: 300
      })
      .catch(() => {
        /* ignore */
      });
  }, [rfInstance]);

  const handleClear = useCallback(() => {
    setSearchTerm("");
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        zoomToMatches();
      } else if (event.key === "Escape") {
        handleClear();
      }
    },
    [zoomToMatches, handleClear]
  );

  const hasCount = matchCount !== null;
  const countColor = matchCount !== null && matchCount > 0 ? "green" : "yellow";
  const showClear = searchTerm.length > 0;
  const showRightSection = showClear || hasCount;
  const rightSectionWidth = (hasCount ? 26 : 0) + (showClear ? 30 : 0) + 6;

  return (
    <TextInput
      ref={inputRef}
      size="xs"
      radius="xl"
      w={200}
      placeholder="Search nodes"
      value={searchTerm}
      disabled={disabled}
      onChange={(event) => setSearchTerm(event.currentTarget.value)}
      onKeyDown={handleKeyDown}
      data-testid="navbar-find-node-input"
      leftSection={
        <IconSearch size={18} style={{ color: "var(--mantine-color-dimmed)" }} />
      }
      rightSectionWidth={showRightSection ? rightSectionWidth : undefined}
      rightSection={
        showRightSection ? (
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {hasCount ? (
              <Tooltip label={formatMatchCountText(matchCount)}>
                <Text
                  size="xs"
                  c={countColor}
                  data-testid="navbar-find-node-count"
                  style={{ marginRight: showClear ? 4 : 0 }}
                >
                  {matchCount}
                </Text>
              </Tooltip>
            ) : null}
            {showClear ? (
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={handleClear}
                data-testid="navbar-find-node-clear"
              >
                <IconX size={18} />
              </ActionIcon>
            ) : null}
          </div>
        ) : undefined
      }
      // Borderless, filled pill matching the floating bar (half the 30px height).
      styles={{
        input: {
          height: 30,
          minHeight: 30,
          border: "none",
          backgroundColor: "var(--vscode-input-background, rgba(127,127,127,0.12))"
        }
      }}
    />
  );
};
