import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ReactFlowInstance } from "@xyflow/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import type { Theme } from "@mui/material/styles";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";

import { useGraphStore } from "../../../stores/graphStore";
import { useCanvasStore } from "../../../stores/canvasStore";
import { controlRadius } from "../../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../../theme/typography";
import { getNodesBoundingBox, isTopoNodeLike } from "../../../utils/graphQueryUtils";

import { formatMatchCountText, getCombinedMatches } from "./findNodeSearchUtils";

export interface FindNodeSearchWidgetProps {
  rfInstance: ReactFlowInstance | null;
  isActive: boolean;
  description?: React.ReactNode;
  dense?: boolean;
  showTipsHeader?: boolean;
  variant?: "panel" | "toolbar";
  /** Toolbar only: a container query below which the empty filter collapses to a search button. */
  collapseBelow?: string;
}

/** The toolbar filter: a slim tinted field that matches the explorer filter. */
function toolbarFieldSx(theme: Theme) {
  const tint = (amount: number) => theme.alpha(theme.palette.text.primary, amount);
  return {
    width: 120,
    "& .MuiFilledInput-root": {
      height: 28,
      fontSize: 13,
      borderRadius: controlRadius,
      overflow: "hidden",
      bgcolor: tint(0.06),
      transition: "background-color 120ms ease, box-shadow 120ms ease",
      "&:hover": { bgcolor: tint(0.06), boxShadow: `inset 0 0 0 1px ${tint(0.18)}` },
      "&.Mui-focused": { bgcolor: tint(0.04), boxShadow: `inset 0 0 0 1px ${theme.palette.action.focus}` },
      "&.Mui-disabled": { bgcolor: tint(0.04) },
      "& .MuiFilledInput-input": { py: 0, px: 1, height: 28, boxSizing: "border-box" },
      "& .MuiIconButton-root": { p: "2px", mr: "-4px" },
      "& .MuiSvgIcon-root": { fontSize: 16 }
    }
  } as const;
}

export const FindNodeSearchWidget: React.FC<FindNodeSearchWidgetProps> = ({
  rfInstance,
  isActive,
  description,
  dense = false,
  showTipsHeader = false,
  variant = "panel",
  collapseBelow
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const getCurrentNodes = useCallback(
    () => useGraphStore.getState().nodes.filter((node) => isTopoNodeLike(node)),
    []
  );
  const setNodeFilter = useCanvasStore((state) => state.setNodeFilter);

  useEffect(() => {
    if (isActive && variant !== "toolbar") {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isActive, variant]);

  useEffect(() => {
    if (!isActive) {
      setMatchCount(null);
      if (variant === "toolbar") setNodeFilter("");
    }
  }, [isActive, setNodeFilter, variant]);

  useEffect(() => {
    if (variant !== "toolbar") return;
    const term = searchTerm.trim();
    setNodeFilter(term);
    if (!term) {
      setMatchCount(null);
      return;
    }
    const currentNodes = rfInstance
      ? rfInstance.getNodes().filter((node) => isTopoNodeLike(node))
      : getCurrentNodes();
    setMatchCount(getCombinedMatches(currentNodes, searchTerm).length);
  }, [getCurrentNodes, rfInstance, searchTerm, setNodeFilter, variant]);

  useEffect(() => {
    if (variant !== "toolbar") return;
    return () => setNodeFilter("");
  }, [setNodeFilter, variant]);

  const handleSearch = useCallback(() => {
    if (!searchTerm.trim()) {
      setMatchCount(null);
      return;
    }

    const currentNodes = rfInstance
      ? rfInstance.getNodes().filter((node) => isTopoNodeLike(node))
      : getCurrentNodes();
    const combinedMatches = getCombinedMatches(currentNodes, searchTerm);
    setMatchCount(combinedMatches.length);

    if (combinedMatches.length > 0 && rfInstance) {
      const bounds = getNodesBoundingBox(combinedMatches);
      if (bounds) {
        rfInstance
          .fitBounds(
            { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
            { padding: 0.2, duration: 300 }
          )
          .catch(() => {
            /* ignore */
          });
      }
    }
  }, [searchTerm, rfInstance, getCurrentNodes]);

  const handleClear = useCallback(() => {
    setSearchTerm("");
    setMatchCount(null);
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleSearch();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleClear();
      }
    },
    [handleSearch, handleClear]
  );

  if (variant === "toolbar") {
    // Expanded or holding a filter, the field stays open whatever the room.
    const collapsed = collapseBelow !== undefined && !expanded && !searchTerm;
    return (
      <Box
        aria-live="polite"
        data-match-count={matchCount === null ? undefined : formatMatchCountText(matchCount)}
        data-testid="navbar-find-node"
        sx={{
          display: "flex",
          alignItems: "center",
          // The field's height, so the bar keeps its height when the field collapses.
          minHeight: 28,
          mx: 0.5,
          "& .find-node-expand": { display: "none" },
          ...(collapseBelow && collapsed
            ? {
                [collapseBelow]: {
                  mx: 0,
                  "& .find-node-field": { display: "none" },
                  "& .find-node-expand": { display: "inline-flex" }
                }
              }
            : {})
        }}
        title={matchCount !== null ? formatMatchCountText(matchCount) : undefined}
      >
        {collapseBelow !== undefined && (
          <Tooltip title="Find nodes">
            <span className="find-node-expand">
              <IconButton
                aria-label="Find nodes"
                size="small"
                disabled={!isActive}
                onClick={() => {
                  setExpanded(true);
                  requestAnimationFrame(() => inputRef.current?.focus());
                }}
              >
                <SearchIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
        <TextField
          className="find-node-field"
          disabled={!isActive}
          hiddenLabel
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (!searchTerm) setExpanded(false);
          }}
          inputRef={inputRef}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Filter"
          size="small"
          value={searchTerm}
          variant="filled"
          data-testid="find-node-input"
          sx={toolbarFieldSx}
          slotProps={{
            htmlInput: { "aria-label": "Find nodes" },
            input: {
              disableUnderline: true,
              endAdornment: searchTerm ? (
                <InputAdornment position="end">
                  <IconButton
                    data-testid="find-node-clear-btn"
                    edge="end"
                    aria-label="Clear node search"
                    onClick={handleClear}
                    size="small"
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : undefined
            }
          }}
        />
      </Box>
    );
  }

  const mbInput = dense ? 1.5 : 2;
  const mbActions = dense ? 1.5 : 2;
  const hasDescription = description !== undefined && description !== null;

  return (
    <>
      <Typography variant="subtitle1" sx={{ mb: "1rem" }}>
        Find Node
      </Typography>

      {hasDescription ? (
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            mb: mbInput
          }}
        >
          {description}
        </Typography>
      ) : null}

      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: mbInput }}>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          label="Search"
          placeholder="Search for nodes..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          data-testid="find-node-input"
          slotProps={{
            htmlInput: { "aria-label": "Find nodes" },
            input: {
              endAdornment: searchTerm ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    aria-label="Clear node search"
                    onClick={handleClear}
                    edge="end"
                    data-testid="find-node-clear-btn"
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : undefined
            }
          }}
        />
        <IconButton
          onClick={handleSearch}
          data-testid="find-node-search-btn"
          sx={{ width: 32, height: 32, border: 1, borderColor: "divider" }}
        >
          <SearchIcon fontSize="small" />
        </IconButton>
      </Box>

      {matchCount !== null && (
        <Box sx={{ mb: mbActions }}>
          <Typography
            variant="body2"
            sx={{ color: matchCount > 0 ? "success.main" : "warning.main" }}
            data-testid="find-node-match-count"
          >
            {formatMatchCountText(matchCount)}
          </Typography>
        </Box>
      )}

      <Box sx={{ mt: dense ? 0 : 2 }}>
        {showTipsHeader ? (
          <Typography variant="subtitle2" gutterBottom>
            Search tips:
          </Typography>
        ) : null}
        <Typography
          variant="caption"
          component="ul"
          sx={{
            color: "text.secondary",
            pl: 2,
            m: 0,
            "& li": { mb: 0.25 },
            "& code": { fontFamily: MONO_FONT_FAMILY }
          }}
        >
          <li>
            Use <code>*</code> for wildcard (e.g., <code>srl*</code>)
          </li>
          <li>
            Use <code>+</code> prefix for starts-with
          </li>
          <li>
            Press <code>Enter</code> to search
          </li>
        </Typography>
      </Box>
    </>
  );
};
