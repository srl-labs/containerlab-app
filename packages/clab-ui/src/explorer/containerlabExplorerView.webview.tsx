import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClabUiHost } from "../host";
import { useMessageListener, useReadySignal } from "./shared/hooks";
import {
  EXPLORER_SECTION_ORDER,
  type ExplorerAction,
  type ExplorerIncomingMessage,
  type ExplorerNode,
  type ExplorerSectionId,
  type ExplorerSectionSnapshot,
  type ExplorerUiState
} from "./shared/explorer/types";
import {
  buildExplorerUiState,
  flattenNodeIds,
  nextExpandedBySectionForSnapshot,
  shouldPersistExpandedSectionImmediately,
  withExpandedSectionItems
} from "./explorerUiState";
import {
  DEFAULT_EXPANDED_SECTIONS,
  FILTER_UPDATE_DEBOUNCE_MS,
  FIXED_HEIGHT_SECTIONS,
  UI_STATE_UPDATE_DEBOUNCE_MS
} from "./view/constants";
import type {
  ErrorExplorerMessage,
  FilterStateExplorerMessage,
  SnapshotExplorerMessage,
  UiStateExplorerMessage
} from "./view/types";
import {
  isBareTreeSection,
  isExplorerSectionId,
  mergeSectionOrder,
  reorderSections
} from "./view/sectionModel";
import { SectionToolbarActions } from "./view/SectionTree";
import { ResizeDivider, normalizeHeightRatios, usePaneResize } from "./view/paneLayout";
import { ExplorerSectionCard } from "./view/ExplorerSectionCard";

export function ContainerlabExplorerView({ visibleSectionIds }: { visibleSectionIds?: readonly ExplorerSectionId[] } = {}) {
  const host = useClabUiHost();
  const [sections, setSections] = useState<ExplorerSectionSnapshot[]>([]);
  const [sectionOrder, setSectionOrder] = useState<ExplorerSectionId[]>(EXPLORER_SECTION_ORDER);
  const [collapsedBySection, setCollapsedBySection] = useState<
    Partial<Record<ExplorerSectionId, boolean>>
  >({});
  const [expandedBySection, setExpandedBySection] = useState<
    Partial<Record<ExplorerSectionId, string[]>>
  >({
    runningLabs: [],
    localLabs: []
  });
  const [filterText, setFilterText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorOpen, setErrorOpen] = useState(false);
  const [draggingSection, setDraggingSection] = useState<ExplorerSectionId | null>(null);
  const [dragOverSection, setDragOverSection] = useState<ExplorerSectionId | null>(null);
  const [heightRatioBySection, setHeightRatioBySection] = useState<
    Partial<Record<ExplorerSectionId, number>>
  >({});
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  const paneContainerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Partial<Record<ExplorerSectionId, HTMLDivElement | null>>>({});
  const pendingFilterSyncRef = useRef<string | null>(null);
  const filterTimeoutRef = useRef<number | null>(null);
  const uiStateTimeoutRef = useRef<number | null>(null);
  const expandedBeforeFilterRef = useRef<Partial<Record<ExplorerSectionId, string[]>> | null>(null);
  const latestUiStateRef = useRef<ExplorerUiState>(
    buildExplorerUiState({
      sectionOrder,
      collapsedBySection,
      expandedBySection,
      heightRatioBySection
    })
  );

  const handleSnapshotMessage = useCallback((message: SnapshotExplorerMessage) => {
    const pending = pendingFilterSyncRef.current;
    if (pending !== null && message.filterText !== pending) {
      return;
    }
    if (pending !== null && message.filterText === pending) {
      pendingFilterSyncRef.current = null;
    }

    setSections(message.sections);
    setSectionOrder((currentOrder) => mergeSectionOrder(currentOrder, message.sections));
    setCollapsedBySection((current) => {
      const next: Partial<Record<ExplorerSectionId, boolean>> = {};
      for (const section of message.sections) {
        next[section.id] = isBareTreeSection(section)
          ? false
          : (current[section.id] ?? !DEFAULT_EXPANDED_SECTIONS.has(section.id));
      }
      if (message.filterText.length > 0) {
        next.runningLabs = false;
        next.localLabs = false;
      }
      return next;
    });

    setExpandedBySection((current) => {
      const next = nextExpandedBySectionForSnapshot({
        current,
        expandedBeforeFilter: expandedBeforeFilterRef.current,
        filterText: message.filterText,
        sections: message.sections
      });
      expandedBeforeFilterRef.current = next.expandedBeforeFilter ?? null;
      return next.expandedBySection ?? current;
    });

    setFilterText(message.filterText);
  }, []);

  const handleFilterStateMessage = useCallback((message: FilterStateExplorerMessage) => {
    const pending = pendingFilterSyncRef.current;
    if (pending !== null && message.filterText !== pending) {
      return;
    }
    if (pending !== null && message.filterText === pending) {
      pendingFilterSyncRef.current = null;
    }
    setFilterText(message.filterText);
  }, []);

  const handleUiStateMessage = useCallback((message: UiStateExplorerMessage) => {
    const state = message.state || {};
    if (Array.isArray(state.sectionOrder) && state.sectionOrder.length > 0) {
      setSectionOrder(state.sectionOrder.filter((id) => isExplorerSectionId(id)));
    }
    if (state.collapsedBySection) {
      setCollapsedBySection(state.collapsedBySection);
    }
    if (state.expandedBySection) {
      setExpandedBySection(state.expandedBySection);
    }
    if (state.heightRatioBySection) {
      setHeightRatioBySection(state.heightRatioBySection);
    }
    setUiStateHydrated(true);
  }, []);

  const handleErrorMessage = useCallback((message: ErrorExplorerMessage) => {
    setErrorMessage(message.message);
    setErrorOpen(true);
  }, []);

  const handleErrorClose = useCallback(() => {
    setErrorOpen(false);
  }, []);

  useMessageListener<ExplorerIncomingMessage>(
    useCallback(
      (message) => {
        switch (message.command) {
          case "snapshot":
            handleSnapshotMessage(message);
            return;
          case "filterState":
            handleFilterStateMessage(message);
            return;
          case "uiState":
            handleUiStateMessage(message);
            return;
          case "error":
            handleErrorMessage(message);
            break;
          default:
            break;
        }
      },
      [handleErrorMessage, handleFilterStateMessage, handleSnapshotMessage, handleUiStateMessage]
    )
  );
  useReadySignal();

  const invokeAction = useCallback(
    (action: ExplorerAction) => {
      if (action.disabled === true) {
        return;
      }
      void Promise.resolve(host.explorer.invokeAction(action.actionRef));
    },
    [host]
  );

  const persistExplorerUiStateImmediately = useCallback(
    (uiState: ExplorerUiState) => {
      latestUiStateRef.current = uiState;
      if (uiStateTimeoutRef.current !== null) {
        window.clearTimeout(uiStateTimeoutRef.current);
        uiStateTimeoutRef.current = null;
      }
      if (!uiStateHydrated) {
        return;
      }
      void Promise.resolve(host.explorer.persistUiState(uiState));
    },
    [host, uiStateHydrated]
  );

  const handleFilterChange = useCallback(
    (value: string) => {
      setFilterText(value);
      pendingFilterSyncRef.current = value.trim();

      if (filterTimeoutRef.current !== null) {
        window.clearTimeout(filterTimeoutRef.current);
        filterTimeoutRef.current = null;
      }

      if (value.trim().length === 0) {
        void Promise.resolve(host.explorer.setFilter(""));
        return;
      }

      filterTimeoutRef.current = window.setTimeout(() => {
        filterTimeoutRef.current = null;
        void Promise.resolve(host.explorer.setFilter(value));
      }, FILTER_UPDATE_DEBOUNCE_MS);
    },
    [host]
  );

  const applyExpandedItemsChange = useCallback(
    (sectionId: ExplorerSectionId, itemIds: string[]) => {
      const nextExpandedBySection = withExpandedSectionItems(
        latestUiStateRef.current.expandedBySection,
        sectionId,
        itemIds
      );
      const nextUiState = {
        ...latestUiStateRef.current,
        expandedBySection: nextExpandedBySection
      };
      latestUiStateRef.current = nextUiState;
      setExpandedBySection(nextExpandedBySection);
      if (shouldPersistExpandedSectionImmediately(sectionId)) {
        persistExplorerUiStateImmediately(nextUiState);
      }
    },
    [persistExplorerUiStateImmediately]
  );

  const handleExpandedItemsChange = useCallback(
    (sectionId: ExplorerSectionId, itemIds: string[]) => {
      applyExpandedItemsChange(sectionId, itemIds);
    },
    [applyExpandedItemsChange]
  );

  const expandAllInSection = useCallback(
    (sectionId: ExplorerSectionId, nodes: ExplorerNode[]) => {
      applyExpandedItemsChange(sectionId, flattenNodeIds(nodes));
    },
    [applyExpandedItemsChange]
  );

  const collapseAllInSection = useCallback(
    (sectionId: ExplorerSectionId) => {
      applyExpandedItemsChange(sectionId, []);
    },
    [applyExpandedItemsChange]
  );

  const sectionsById = useMemo(() => {
    const map = new Map<ExplorerSectionId, ExplorerSectionSnapshot>();
    for (const section of sections) {
      map.set(section.id, section);
    }
    return map;
  }, [sections]);

  const orderedSections = useMemo(() => {
    const visible: ExplorerSectionSnapshot[] = [];
    for (const sectionId of sectionOrder) {
      const section = sectionsById.get(sectionId);
      if (section && (!visibleSectionIds || visibleSectionIds.includes(sectionId))) {
        visible.push(section);
      }
    }
    return visible;
  }, [sectionOrder, sectionsById, visibleSectionIds]);

  // An embedding that shows one section (the rail's Files panel) already titles it.
  const isSoleEmbeddedSection = visibleSectionIds !== undefined && orderedSections.length === 1;

  const orderedSectionIds = useMemo(() => orderedSections.map((s) => s.id), [orderedSections]);

  const floatingToolbarActions = useMemo(() => {
    const primaryBareTreeSection = orderedSections.find((section) => isBareTreeSection(section));
    return primaryBareTreeSection?.toolbarActions ?? [];
  }, [orderedSections]);

  const toggleSectionCollapsed = useCallback(
    (sectionId: ExplorerSectionId) => {
      setCollapsedBySection((current) => {
        const section = sectionsById.get(sectionId);
        if (section && isBareTreeSection(section)) {
          return current;
        }
        const wasCollapsed = current[sectionId] ?? false;
        const next = { ...current, [sectionId]: !wasCollapsed };

        const expandedAfter = orderedSectionIds.filter(
          (id) => !next[id] && !FIXED_HEIGHT_SECTIONS.has(id)
        );
        setHeightRatioBySection((currentRatios) =>
          normalizeHeightRatios(currentRatios, expandedAfter)
        );

        return next;
      });
    },
    [orderedSectionIds, sectionsById]
  );

  const setSectionRef = useCallback(
    (sectionId: ExplorerSectionId, element: HTMLDivElement | null) => {
      sectionRefs.current[sectionId] = element;
    },
    []
  );

  const handleSectionDragStart = useCallback(
    (sectionId: ExplorerSectionId) => (event: DragEvent<HTMLDivElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", sectionId);
      setDraggingSection(sectionId);
      setDragOverSection(sectionId);
    },
    []
  );

  const handleSectionDragOver = useCallback(
    (sectionId: ExplorerSectionId) => (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (draggingSection && draggingSection !== sectionId) {
        setDragOverSection(sectionId);
      }
    },
    [draggingSection]
  );

  const handleSectionDrop = useCallback(
    (targetId: ExplorerSectionId) => (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const sourceValue = event.dataTransfer.getData("text/plain");
      const sourceId = isExplorerSectionId(sourceValue) ? sourceValue : draggingSection;

      if (!sourceId || sourceId === targetId) {
        setDraggingSection(null);
        setDragOverSection(null);
        return;
      }

      setSectionOrder((currentOrder) => reorderSections(currentOrder, sourceId, targetId));
      setDraggingSection(null);
      setDragOverSection(null);
    },
    [draggingSection]
  );

  const handleSectionDragEnd = useCallback(() => {
    setDraggingSection(null);
    setDragOverSection(null);
  }, []);

  const { isResizing, handleResizeStart } = usePaneResize(
    paneContainerRef,
    heightRatioBySection,
    setHeightRatioBySection,
    collapsedBySection,
    orderedSections
  );

  const sectionFlexStyles = useMemo(() => {
    const styles: Partial<Record<ExplorerSectionId, string>> = {};
    const expandedIds = orderedSectionIds.filter(
      (id) => !collapsedBySection[id] && !FIXED_HEIGHT_SECTIONS.has(id)
    );
    const n = expandedIds.length;
    for (const id of orderedSectionIds) {
      if (collapsedBySection[id] || FIXED_HEIGHT_SECTIONS.has(id)) {
        styles[id] = "0 0 auto";
      } else {
        const ratio = heightRatioBySection[id] ?? (n > 0 ? 1 / n : 1);
        styles[id] = `${ratio} 1 0px`;
      }
    }
    return styles;
  }, [orderedSectionIds, collapsedBySection, heightRatioBySection]);

  useEffect(
    () => () => {
      if (filterTimeoutRef.current !== null) {
        window.clearTimeout(filterTimeoutRef.current);
      }
      if (uiStateTimeoutRef.current !== null) {
        window.clearTimeout(uiStateTimeoutRef.current);
      }
    },
    []
  );

  useEffect(() => {
    const uiState = buildExplorerUiState({
      sectionOrder,
      collapsedBySection,
      expandedBySection,
      heightRatioBySection
    });
    latestUiStateRef.current = uiState;

    if (!uiStateHydrated) {
      return;
    }

    if (uiStateTimeoutRef.current !== null) {
      window.clearTimeout(uiStateTimeoutRef.current);
    }
    uiStateTimeoutRef.current = window.setTimeout(() => {
      uiStateTimeoutRef.current = null;
      void Promise.resolve(host.explorer.persistUiState(uiState));
    }, UI_STATE_UPDATE_DEBOUNCE_MS);
  }, [
    sectionOrder,
    collapsedBySection,
    expandedBySection,
    heightRatioBySection,
    host,
    uiStateHydrated
  ]);

  return (
    <Box
      className="containerlab-explorer-root"
      sx={{
        width: "100%",
        maxWidth: "100%",
        height: "100%",
        minHeight: 0,
        boxSizing: "border-box",
        overflow: "hidden",
        containerType: "inline-size",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        pt: 0,
        px: 0,
        pb: 0,
        gap: 0
      }}
    >
      <Snackbar
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
        autoHideDuration={10000}
        open={errorOpen && Boolean(errorMessage)}
        onClose={handleErrorClose}
        sx={{
          mt: 1,
          mr: 1,
          maxWidth: { xs: "calc(100vw - 16px)", sm: 560 }
        }}
      >
        <Alert
          severity="error"
          variant="filled"
          onClose={handleErrorClose}
          sx={{
            width: "100%",
            alignItems: "flex-start",
            "& .MuiAlert-message": {
              whiteSpace: "pre-wrap",
              wordBreak: "break-word"
            }
          }}
        >
          {errorMessage}
        </Alert>
      </Snackbar>

      <Stack
        direction="row"
        spacing={0.5}
        sx={{ alignItems: "center", px: 1, pt: 1, pb: 0.75 }}
      >
        <TextField
          size="small"
          fullWidth
          value={filterText}
          placeholder="Filter labs, nodes, interfaces"
          onChange={(event) => handleFilterChange(event.target.value)}
          sx={(theme) => ({
            "& .MuiOutlinedInput-root": {
              height: 30,
              borderRadius: "8px",
              fontSize: "0.8125rem",
              bgcolor: theme.alpha(theme.palette.text.primary, 0.06),
              transition: "background-color 90ms ease",
              "& fieldset": { borderColor: "transparent", borderWidth: 1 },
              "&:hover fieldset": { borderColor: theme.alpha(theme.palette.text.primary, 0.18) },
              "&.Mui-focused": { bgcolor: theme.alpha(theme.palette.text.primary, 0.04) },
              "&.Mui-focused fieldset": {
                borderColor: theme.alpha(theme.palette.text.primary, 0.45),
                borderWidth: 1
              }
            },
            "& .MuiOutlinedInput-input": { py: 0, px: 0.5 }
          })}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start" sx={{ mr: 0 }}>
                  <SearchRoundedIcon sx={{ fontSize: 16, color: "text.disabled" }} />
                </InputAdornment>
              ),
              endAdornment:
                filterText.length > 0 ? (
                  <InputAdornment position="end" sx={{ ml: 0 }}>
                    <IconButton
                      size="small"
                      aria-label="Clear filter"
                      onClick={() => handleFilterChange("")}
                      sx={{ p: 0.25, color: "text.secondary" }}
                    >
                      <CloseRoundedIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </InputAdornment>
                ) : undefined
            }
          }}
        />
        {floatingToolbarActions.length > 0 && (
          <SectionToolbarActions actions={floatingToolbarActions} onInvokeAction={invokeAction} />
        )}
      </Stack>

      <Box
        ref={paneContainerRef}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          ...(isResizing && { cursor: "row-resize", userSelect: "none" })
        }}
      >
        {orderedSections.map((section, index) => {
          const isExpanded = !(collapsedBySection[section.id] ?? false);
          const prevExpandedId = (() => {
            for (let i = index - 1; i >= 0; i--) {
              if (!(collapsedBySection[orderedSections[i].id] ?? false)) {
                return orderedSections[i].id;
              }
            }
            return null;
          })();

          return (
            <Box key={section.id} sx={{ display: "contents" }}>
              {isExpanded &&
                prevExpandedId &&
                !FIXED_HEIGHT_SECTIONS.has(section.id) &&
                !FIXED_HEIGHT_SECTIONS.has(prevExpandedId) && (
                  <ResizeDivider
                    aboveId={prevExpandedId}
                    belowId={section.id}
                    onResizeStart={handleResizeStart}
                  />
                )}
              <ExplorerSectionCard
                section={section}
                headerless={isSoleEmbeddedSection}
                expandedItems={expandedBySection[section.id] ?? []}
                isCollapsed={!isSoleEmbeddedSection && (collapsedBySection[section.id] ?? false)}
                isDropTarget={dragOverSection === section.id && draggingSection !== section.id}
                isBeingDragged={draggingSection === section.id}
                flexStyle={sectionFlexStyles[section.id] ?? "0 0 auto"}
                onSetSectionRef={setSectionRef}
                onSectionDragStart={handleSectionDragStart}
                onSectionDragOver={handleSectionDragOver}
                onSectionDrop={handleSectionDrop}
                onSectionDragEnd={handleSectionDragEnd}
                onToggleSectionCollapsed={toggleSectionCollapsed}
                onInvokeAction={invokeAction}
                onExpandedItemsChange={handleExpandedItemsChange}
                onExpandAllInSection={expandAllInSection}
                onCollapseAllInSection={collapseAllInSection}
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
