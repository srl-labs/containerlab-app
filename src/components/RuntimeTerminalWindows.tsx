import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Popover from "@mui/material/Popover";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import {
  CleaningServices as ClearIcon,
  Close as CloseIcon,
  ContentCopy as CopyIcon,
  Download as DownloadIcon,
  Minimize as MinimizeIcon,
  OpenInFull as RestoreIcon,
  RestartAlt as ResetIcon,
  Subject as ExportLogIcon,
  Tune as ActionsIcon
} from "@mui/icons-material";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import {
  closeTerminalSession,
  connectTerminalSessionWebSocket,
  openTerminalSession
} from "../runtimeApi";
import {
  DEFAULT_TERMINAL_FONT_SIZE,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_PRESETS,
  clampTerminalFontSize,
  resolveTerminalSshUsername
} from "../runtimeTerminalSettings";
import type { TerminalPreferences } from "../runtimeTerminalSettings";
import type { ContainerState, LabState } from "../stores/labStore";
import { useLabStore } from "../stores/labStore";
import {
  runtimeUiActions,
  useRuntimeUiStore,
  type RuntimeTerminalWindow
} from "../stores/runtimeUiStore";
import { findLabStateForTopology } from "../standaloneHostShared";
import {
  createTerminalExportFileName,
  extractTerminalText,
  resolveTerminalCopyText,
  type TerminalExportScope
} from "../runtimeTerminalActions";
import {
  resolveTerminalFontShortcutAction,
  resolveTerminalWheelZoomDelta
} from "../runtimeTerminalZoomShortcuts";

function scoreNodeMatch(labName: string, container: ContainerState, requestedNodeName: string): number {
  const normalizedRequested = requestedNodeName.trim().toLowerCase();
  if (!normalizedRequested) {
    return 0;
  }
  const normalizedContainerName = container.name.trim().toLowerCase();
  if (normalizedContainerName === normalizedRequested) {
    return 100;
  }

  const normalizedNodeName = container.nodeName.trim().toLowerCase();
  if (normalizedNodeName === normalizedRequested) {
    return 90;
  }

  const prefix = `clab-${labName.toLowerCase()}-`;
  const shortName = normalizedContainerName.startsWith(prefix)
    ? normalizedContainerName.slice(prefix.length)
    : normalizedContainerName;
  if (shortName === normalizedRequested) {
    return 80;
  }

  return 0;
}

function findRuntimeContainer(
  labs: Map<string, LabState>,
  input: {
    endpointId?: string;
    nodeName: string;
    topologyRef?: RuntimeTerminalWindow["topologyRef"];
  }
): ContainerState | undefined {
  const topologyHint = input.topologyRef?.yamlPath
    ? {
        topologyId: input.topologyRef.topologyId,
        yamlPath: input.topologyRef.yamlPath,
        labName: input.topologyRef.labName,
        endpointId: input.endpointId
      }
    : undefined;
  const lab = findLabStateForTopology(topologyHint, labs);
  const candidateLabs = lab ? [lab] : [...labs.values()];

  let bestContainer: ContainerState | undefined;
  let bestScore = 0;
  for (const candidateLab of candidateLabs) {
    for (const container of candidateLab.containers.values()) {
      const score = scoreNodeMatch(candidateLab.name, container, input.nodeName);
      if (score > bestScore) {
        bestContainer = container;
        bestScore = score;
      }
    }
  }

  return bestScore > 0 ? bestContainer : undefined;
}

function decodeBase64ToBytes(value: string): Uint8Array {
  const raw = window.atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function statusColor(windowState: RuntimeTerminalWindow): "default" | "error" | "success" | "warning" {
  switch (windowState.state) {
    case "ready":
      return "success";
    case "error":
      return "error";
    case "exited":
      return "warning";
    default:
      return "default";
  }
}

function readCssColor(styles: CSSStyleDeclaration, property: string, fallback: string): string {
  const value = styles.getPropertyValue(property).trim();
  return value || fallback;
}

function parseColorChannels(color: string): [number, number, number] | null {
  const match = color.match(/rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isDarkColor(color: string): boolean {
  const channels = parseColorChannels(color);
  if (!channels) {
    return false;
  }
  const [red, green, blue] = channels;
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  return luminance < 0.5;
}

function resolveTerminalTheme(element: HTMLElement | null) {
  const styles = getComputedStyle(element ?? document.body);
  const background = readCssColor(styles, "background-color", "#111827");
  const foreground = readCssColor(styles, "color", "#e5e7eb");
  const darkBackground = isDarkColor(background);
  const rootStyles = getComputedStyle(document.documentElement);

  return {
    background,
    foreground,
    cursor: readCssColor(rootStyles, "--clab-ui-focus-border", darkBackground ? "#93c5fd" : "#2563eb"),
    selectionBackground: readCssColor(
      rootStyles,
      "--clab-ui-selection-background",
      darkBackground ? "rgba(147, 197, 253, 0.22)" : "rgba(37, 99, 235, 0.18)"
    )
  };
}

function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function consumeToolbarMouseEvent(event: React.MouseEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

const FONT_SIZE_PERSIST_DELAY_MS = 220;

function hasTerminalDomFocus(root: HTMLDivElement | null): boolean {
  if (!root) {
    return false;
  }
  const activeElement = document.activeElement;
  return activeElement instanceof Node && root.contains(activeElement);
}

function TerminalWindow({
  onSaveTerminalPreferences,
  terminalPreferences,
  windowState
}: {
  onSaveTerminalPreferences: (
    next: TerminalPreferences,
    options?: {
      notify?: boolean;
    }
  ) => void;
  terminalPreferences: TerminalPreferences;
  windowState: RuntimeTerminalWindow;
}) {
  const labs = useLabStore((state) => state.labs);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    nextX: number;
    nextY: number;
    frameId: number | null;
  } | null>(null);
  const latestWindowRef = useRef(windowState);
  const sessionClosedRef = useRef(false);
  const latestPreferencesRef = useRef(terminalPreferences);
  const fontSizePreviewRef = useRef(terminalPreferences.fontSize);
  const fontSizePersistTimerRef = useRef<number | null>(null);
  const [fontSizePreview, setFontSizePreview] = useState(terminalPreferences.fontSize);
  const [actionsAnchorElement, setActionsAnchorElement] = useState<HTMLElement | null>(null);
  const focusedTerminalId = useRuntimeUiStore((state) => {
    let focused: RuntimeTerminalWindow | null = null;
    for (const terminal of state.terminals) {
      if (!focused || terminal.zIndex > focused.zIndex) {
        focused = terminal;
      }
    }
    return focused?.id ?? null;
  });
  const actionsPopoverOpen = actionsAnchorElement !== null;
  const isTerminalFocused = focusedTerminalId === windowState.id && !windowState.minimized;

  const runtimeContainer = useMemo(
    () =>
      findRuntimeContainer(labs, {
        endpointId: windowState.endpointId,
        topologyRef: windowState.topologyRef,
        nodeName: windowState.nodeName
      }),
    [labs, windowState.endpointId, windowState.nodeName, windowState.topologyRef]
  );

  useEffect(() => {
    latestWindowRef.current = windowState;
  }, [windowState]);

  useEffect(() => {
    latestPreferencesRef.current = terminalPreferences;
  }, [terminalPreferences]);

  useEffect(() => {
    fontSizePreviewRef.current = terminalPreferences.fontSize;
    setFontSizePreview(terminalPreferences.fontSize);
  }, [terminalPreferences.fontSize]);

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: terminalPreferences.fontSize,
      theme: resolveTerminalTheme(terminalRef.current)
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    requestAnimationFrame(() => fitAddon.fit());
    term.write(`Opening ${windowState.protocol} terminal for ${windowState.nodeName}...\r\n`);

    const dataDisposable = term.onData((data) => {
      const socket = websocketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    const observer = new ResizeObserver(() => {
      if (latestWindowRef.current.minimized) {
        return;
      }
      fitAddon.fit();
      runtimeUiActions.updateTerminalLayout(windowState.id, {
        width: rootRef.current?.offsetWidth,
        height: rootRef.current?.offsetHeight
      });
      const socket = websocketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "resize",
            cols: term.cols,
            rows: term.rows
          })
        );
      }
    });

    if (rootRef.current) {
      observer.observe(rootRef.current);
    }

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    resizeObserverRef.current = observer;

    return () => {
      dataDisposable.dispose();
      observer.disconnect();
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
      resizeObserverRef.current = null;
    };
  }, [
    windowState.id,
    windowState.nodeName,
    windowState.protocol
  ]);

  useEffect(() => {
    if (!xtermRef.current) {
      return;
    }

    const applyTerminalTheme = () => {
      if (!xtermRef.current) {
        return;
      }
      xtermRef.current.options.theme = resolveTerminalTheme(terminalRef.current);
      fitAddonRef.current?.fit();
    };

    applyTerminalTheme();

    const observer = new MutationObserver(() => {
      applyTerminalTheme();
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"]
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"]
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const term = xtermRef.current;
    if (!term) {
      return;
    }
    term.options.fontSize = fontSizePreview;
    fitAddonRef.current?.fit();
  }, [fontSizePreview]);

  useEffect(() => {
    fitAddonRef.current?.fit();
  }, [windowState.width, windowState.height, windowState.minimized]);

  useEffect(() => {
    if (windowState.state !== "creating" || xtermRef.current === null) {
      return;
    }

    let cancelled = false;
    const sshUsername =
      windowState.protocol === "ssh"
        ? resolveTerminalSshUsername(runtimeContainer?.kind, terminalPreferences)
        : undefined;
    const telnetPort = windowState.protocol === "telnet" ? terminalPreferences.telnetPort : undefined;
    const cols = xtermRef.current.cols || 120;
    const rows = xtermRef.current.rows || 36;

    void openTerminalSession({
      endpointId: windowState.endpointId,
      sessionId: windowState.sessionId,
      topologyRef: windowState.topologyRef,
      nodeName: windowState.nodeName,
      protocol: windowState.protocol,
      cols,
      rows,
      sshUsername,
      telnetPort
    })
      .then((session) => {
        if (cancelled) {
          void closeTerminalSession(session.sessionId, windowState.endpointId).catch(() => {});
          return;
        }
        runtimeUiActions.setTerminalSession(windowState.id, session.sessionId);
        runtimeUiActions.setTerminalConnecting(windowState.id);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        xtermRef.current?.write(`\r\n[error] ${message}\r\n`);
        runtimeUiActions.setTerminalError(windowState.id, message);
      });

    return () => {
      cancelled = true;
    };
  }, [
    runtimeContainer?.kind,
    terminalPreferences.sshUserMapping,
    terminalPreferences.telnetPort,
    windowState.endpointId,
    windowState.id,
    windowState.nodeName,
    windowState.protocol,
    windowState.sessionId,
    windowState.state,
    windowState.topologyRef
  ]);

  useEffect(() => {
    if (!windowState.terminalSessionId || websocketRef.current || xtermRef.current === null) {
      return;
    }

    sessionClosedRef.current = false;
    const socket = connectTerminalSessionWebSocket(windowState.terminalSessionId, windowState.endpointId);
    websocketRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as {
          type?: string;
          data?: string;
          encoding?: string;
          exitCode?: number | null;
          error?: string;
        };
        switch (payload.type) {
          case "ready":
            runtimeUiActions.setTerminalReady(windowState.id);
            fitAddonRef.current?.fit();
            if (socket.readyState === WebSocket.OPEN && xtermRef.current) {
              socket.send(
                JSON.stringify({
                  type: "resize",
                  cols: xtermRef.current.cols,
                  rows: xtermRef.current.rows
                })
              );
            }
            break;
          case "output":
            if (payload.data && payload.encoding === "base64" && xtermRef.current) {
              xtermRef.current.write(decodeBase64ToBytes(payload.data));
            }
            break;
          case "exit": {
            const errorMessage = typeof payload.error === "string" ? payload.error : undefined;
            xtermRef.current?.write(
              `\r\n[session ended${payload.exitCode !== undefined ? `: ${payload.exitCode}` : ""}]${
                errorMessage ? ` ${errorMessage}` : ""
              }\r\n`
            );
            runtimeUiActions.setTerminalExited(windowState.id, payload.exitCode, errorMessage);
            break;
          }
          case "error":
            if (payload.error) {
              xtermRef.current?.write(`\r\n[error] ${payload.error}\r\n`);
              runtimeUiActions.setTerminalError(windowState.id, payload.error);
            }
            break;
          default:
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtimeUiActions.setTerminalError(windowState.id, message);
      }
    };

    socket.onerror = () => {
      runtimeUiActions.setTerminalError(windowState.id, "Terminal connection failed.");
    };

    socket.onclose = () => {
      websocketRef.current = null;
      const latestWindow = latestWindowRef.current;
      if (!sessionClosedRef.current && latestWindow.state !== "exited" && latestWindow.state !== "error") {
        runtimeUiActions.setTerminalExited(
          latestWindow.id,
          latestWindow.exitCode,
          latestWindow.error ?? "Connection closed."
        );
      }
    };

    return () => {
      sessionClosedRef.current = true;
      socket.close();
      websocketRef.current = null;
    };
  }, [windowState.endpointId, windowState.id, windowState.terminalSessionId]);

  useEffect(() => {
    return () => {
      const sessionId = windowState.terminalSessionId;
      const socket = websocketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "close" }));
        socket.close();
      }
      if (sessionId) {
        void closeTerminalSession(sessionId, windowState.endpointId).catch(() => {});
      }
    };
  }, [windowState.endpointId, windowState.terminalSessionId]);

  useEffect(() => {
    return () => {
      if (fontSizePersistTimerRef.current !== null) {
        window.clearTimeout(fontSizePersistTimerRef.current);
        fontSizePersistTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (windowState.minimized) {
      setActionsAnchorElement(null);
    }
  }, [windowState.minimized]);

  const handleHeaderMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (windowState.minimized) {
      runtimeUiActions.setTerminalMinimized(windowState.id, false);
    }
    runtimeUiActions.focusTerminal(windowState.id);
    const latestWindow = latestWindowRef.current;
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: latestWindow.x,
      originY: latestWindow.y,
      nextX: latestWindow.x,
      nextY: latestWindow.y,
      frameId: null
    };

    if (rootRef.current) {
      rootRef.current.style.willChange = "transform";
      rootRef.current.style.transition = "none";
    }

    const applyDragPreview = () => {
      const drag = dragStateRef.current;
      const root = rootRef.current;
      if (!drag || !root) {
        return;
      }
      drag.frameId = null;
      root.style.transform = `translate3d(${drag.nextX - drag.originX}px, ${drag.nextY - drag.originY}px, 0)`;
    };

    const handleMove = (moveEvent: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) {
        return;
      }
      drag.nextX = drag.originX + (moveEvent.clientX - drag.startX);
      drag.nextY = drag.originY + (moveEvent.clientY - drag.startY);
      if (drag.frameId === null) {
        drag.frameId = requestAnimationFrame(applyDragPreview);
      }
    };

    const handleUp = () => {
      const drag = dragStateRef.current;
      if (drag && drag.frameId !== null) {
        cancelAnimationFrame(drag.frameId);
      }
      if (rootRef.current) {
        rootRef.current.style.transform = "";
        rootRef.current.style.willChange = "";
        rootRef.current.style.transition = "";
      }
      if (drag && (drag.nextX !== drag.originX || drag.nextY !== drag.originY)) {
        runtimeUiActions.updateTerminalLayout(windowState.id, {
          x: drag.nextX,
          y: drag.nextY
        });
      }
      dragStateRef.current = null;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  };

  const handleClose = () => {
    setActionsAnchorElement(null);
    sessionClosedRef.current = true;
    const socket = websocketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "close" }));
      socket.close();
    }
    if (windowState.terminalSessionId) {
      void closeTerminalSession(windowState.terminalSessionId, windowState.endpointId).catch(() => {});
    }
    runtimeUiActions.closeTerminal(windowState.id);
  };

  const handleExport = useCallback(
    (scope: TerminalExportScope) => {
      const term = xtermRef.current;
      if (!term) {
        runtimeUiActions.notify("Terminal is not ready yet.", "warning");
        return;
      }
      const content = extractTerminalText(term, scope);
      if (content.length === 0) {
        runtimeUiActions.notify(`Terminal ${scope === "screen" ? "screen" : "log"} is empty.`, "warning");
        return;
      }
      const filename = createTerminalExportFileName({
        nodeName: windowState.nodeName,
        protocol: windowState.protocol,
        scope
      });
      downloadTextFile(filename, content);
      runtimeUiActions.notify(
        scope === "screen" ? "Terminal screen exported." : "Terminal log exported.",
        "success"
      );
    },
    [windowState.nodeName, windowState.protocol]
  );

  const handleCopy = useCallback(() => {
    const term = xtermRef.current;
    if (!term) {
      runtimeUiActions.notify("Terminal is not ready yet.", "warning");
      return;
    }
    const content = resolveTerminalCopyText(term);
    if (content.length === 0) {
      runtimeUiActions.notify("Nothing to copy from terminal.", "warning");
      return;
    }
    if (!navigator.clipboard?.writeText) {
      runtimeUiActions.notify("Clipboard API is unavailable.", "error");
      return;
    }
    void navigator.clipboard
      .writeText(content)
      .then(() => runtimeUiActions.notify("Terminal text copied.", "success"))
      .catch(() => runtimeUiActions.notify("Failed to copy terminal text.", "error"));
  }, []);

  const handleClear = useCallback(() => {
    const term = xtermRef.current;
    if (!term) {
      runtimeUiActions.notify("Terminal is not ready yet.", "warning");
      return;
    }
    term.clear();
    runtimeUiActions.notify("Terminal cleared.", "info");
  }, []);

  const handleFontSizeUpdate = useCallback(
    (nextFontSize: number) => {
      const normalized = clampTerminalFontSize(nextFontSize);
      if (normalized === fontSizePreviewRef.current) {
        return;
      }
      fontSizePreviewRef.current = normalized;
      setFontSizePreview(normalized);

      if (fontSizePersistTimerRef.current !== null) {
        window.clearTimeout(fontSizePersistTimerRef.current);
      }
      fontSizePersistTimerRef.current = window.setTimeout(() => {
        fontSizePersistTimerRef.current = null;
        const latestPreferences = latestPreferencesRef.current;
        if (latestPreferences.fontSize === normalized) {
          return;
        }
        onSaveTerminalPreferences(
          {
            ...latestPreferences,
            fontSize: normalized
          },
          { notify: false }
        );
      }, FONT_SIZE_PERSIST_DELAY_MS);
    },
    [onSaveTerminalPreferences]
  );

  const handleFontSliderChange = useCallback(
    (_event: Event, value: number | number[]) => {
      const nextValue = Array.isArray(value) ? value[0] : value;
      handleFontSizeUpdate(nextValue);
    },
    [handleFontSizeUpdate]
  );

  const handleOpenActions = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      consumeToolbarMouseEvent(event);
      runtimeUiActions.focusTerminal(windowState.id);
      setActionsAnchorElement(event.currentTarget);
    },
    [windowState.id]
  );

  const handleCloseActions = useCallback(() => {
    setActionsAnchorElement(null);
  }, []);

  const handleTerminalWheelZoom = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!isTerminalFocused || !hasTerminalDomFocus(rootRef.current)) {
        return;
      }
      const delta = resolveTerminalWheelZoomDelta({
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        deltaY: event.deltaY
      });
      if (delta === 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleFontSizeUpdate(fontSizePreviewRef.current + delta);
    },
    [handleFontSizeUpdate, isTerminalFocused]
  );

  const syncTerminalSizeToSession = useCallback(() => {
    const term = xtermRef.current;
    if (!term) {
      return;
    }
    fitAddonRef.current?.fit();
    const socket = websocketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows
        })
      );
    }
  }, []);

  useEffect(() => {
    if (!isTerminalFocused) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!hasTerminalDomFocus(rootRef.current)) {
        return;
      }
      const shortcutAction = resolveTerminalFontShortcutAction({
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        key: event.key
      });
      if (!shortcutAction) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (shortcutAction === "increase") {
        handleFontSizeUpdate(fontSizePreviewRef.current + 1);
        return;
      }
      if (shortcutAction === "decrease") {
        handleFontSizeUpdate(fontSizePreviewRef.current - 1);
        return;
      }
      handleFontSizeUpdate(DEFAULT_TERMINAL_FONT_SIZE);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [handleFontSizeUpdate, isTerminalFocused]);

  useEffect(() => {
    if (windowState.minimized) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      syncTerminalSizeToSession();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [syncTerminalSizeToSession, windowState.height, windowState.minimized, windowState.width]);

  return (
    <Paper
      ref={rootRef}
      elevation={10}
      onMouseDown={() => runtimeUiActions.focusTerminal(windowState.id)}
      onWheel={handleTerminalWheelZoom}
      data-testid="runtime-terminal-window"
      sx={{
        position: "fixed",
        left: windowState.x,
        top: windowState.y,
        width: windowState.width,
        height: windowState.minimized ? "auto" : windowState.height,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        resize: windowState.minimized ? "none" : "both",
        zIndex: windowState.zIndex,
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        backfaceVisibility: "hidden",
        contain: "layout paint",
        minWidth: 420,
        minHeight: windowState.minimized ? 0 : 220
      }}
    >
      <Box
        onMouseDown={handleHeaderMouseDown}
        sx={{
          cursor: "move",
          px: 1.25,
          py: 0.75,
          borderBottom: windowState.minimized ? 0 : 1,
          borderColor: "divider",
          bgcolor: "action.hover",
          userSelect: "none"
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <Stack sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {windowState.title}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.75 }} noWrap>
              {runtimeContainer?.kind || "node"} • {windowState.nodeName}
            </Typography>
          </Stack>
          <Chip
            size="small"
            label={`${windowState.protocol} • ${windowState.state}`}
            color={statusColor(windowState)}
            variant="outlined"
          />
          <Tooltip title="Terminal Actions">
            <Button
              size="small"
              variant="outlined"
              startIcon={<ActionsIcon fontSize="small" />}
              onMouseDown={consumeToolbarMouseEvent}
              onClick={handleOpenActions}
              data-testid="runtime-terminal-actions-button"
              aria-label="Open terminal actions"
              sx={{ px: 1.1, textTransform: "none", minWidth: 0 }}
            >
              Actions
            </Button>
          </Tooltip>
          <IconButton
            size="small"
            onMouseDown={consumeToolbarMouseEvent}
            onClick={() => runtimeUiActions.setTerminalMinimized(windowState.id, !windowState.minimized)}
            aria-label={windowState.minimized ? "Restore terminal window" : "Minimize terminal window"}
          >
            {windowState.minimized ? <RestoreIcon fontSize="inherit" /> : <MinimizeIcon fontSize="inherit" />}
          </IconButton>
          <IconButton
            size="small"
            onMouseDown={consumeToolbarMouseEvent}
            onClick={handleClose}
            aria-label="Close terminal window"
          >
            <CloseIcon fontSize="inherit" />
          </IconButton>
        </Stack>
      </Box>
      <Popover
        open={actionsPopoverOpen}
        anchorEl={actionsAnchorElement}
        onClose={handleCloseActions}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        disableRestoreFocus
        slotProps={{
          root: {
            sx: {
              zIndex: Math.max(windowState.zIndex + 20, 2500)
            }
          },
          paper: {
            sx: { mt: 0.5, width: 320, maxWidth: "calc(100vw - 24px)", p: 1.5 }
          }
        }}
      >
        <Stack spacing={1.25} data-testid="runtime-terminal-actions-popover">
          <Box>
            <Typography variant="overline" sx={{ lineHeight: 1.1 }}>
              Font
            </Typography>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 0.25 }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }} data-testid="runtime-terminal-font-value">
                {fontSizePreview} px
              </Typography>
              <Button
                size="small"
                variant="text"
                startIcon={<ResetIcon fontSize="small" />}
                onClick={() => handleFontSizeUpdate(DEFAULT_TERMINAL_FONT_SIZE)}
                disabled={fontSizePreview === DEFAULT_TERMINAL_FONT_SIZE}
                data-testid="runtime-terminal-font-reset"
                aria-label="Reset terminal font size"
                sx={{ minWidth: 0 }}
              >
                Reset
              </Button>
            </Stack>
            <Slider
              size="small"
              min={MIN_TERMINAL_FONT_SIZE}
              max={MAX_TERMINAL_FONT_SIZE}
              step={1}
              value={fontSizePreview}
              onChange={handleFontSliderChange}
              aria-label="Terminal font size"
              data-testid="runtime-terminal-font-slider"
              sx={{ mt: 0.5 }}
            />
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 0.5 }}>
              {TERMINAL_FONT_SIZE_PRESETS.map((preset) => (
                <Chip
                  key={preset}
                  size="small"
                  label={`${preset}px`}
                  onClick={() => handleFontSizeUpdate(preset)}
                  variant={fontSizePreview === preset ? "filled" : "outlined"}
                  color={fontSizePreview === preset ? "primary" : "default"}
                  data-testid={`runtime-terminal-font-preset-${preset}`}
                  aria-label={`Set terminal font size to ${preset}`}
                />
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
              Applies to all open/new terminals. Use Alt+Up, Alt+Down, Alt+0 for reliable zoom/reset.
              Ctrl/Cmd shortcuts are best effort in browsers.
            </Typography>
          </Box>
          <Divider />
          <Box>
            <Typography variant="overline" sx={{ lineHeight: 1.1 }}>
              Clipboard & Export
            </Typography>
            <Stack spacing={0.75} sx={{ mt: 0.5 }}>
              <Button
                fullWidth
                size="small"
                variant="outlined"
                startIcon={<CopyIcon fontSize="small" />}
                onClick={handleCopy}
                data-testid="runtime-terminal-copy"
                aria-label="Copy terminal text"
                sx={{ justifyContent: "flex-start", textTransform: "none" }}
              >
                Copy Selection / Screen
              </Button>
              <Button
                fullWidth
                size="small"
                variant="outlined"
                startIcon={<DownloadIcon fontSize="small" />}
                onClick={() => handleExport("screen")}
                data-testid="runtime-terminal-export-screen"
                aria-label="Export visible terminal screen"
                sx={{ justifyContent: "flex-start", textTransform: "none" }}
              >
                Export Visible Screen
              </Button>
              <Button
                fullWidth
                size="small"
                variant="outlined"
                startIcon={<ExportLogIcon fontSize="small" />}
                onClick={() => handleExport("log")}
                data-testid="runtime-terminal-export-log"
                aria-label="Export full terminal log"
                sx={{ justifyContent: "flex-start", textTransform: "none" }}
              >
                Export Full Log
              </Button>
              <Button
                fullWidth
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<ClearIcon fontSize="small" />}
                onClick={handleClear}
                data-testid="runtime-terminal-clear"
                aria-label="Clear terminal buffer"
                sx={{ justifyContent: "flex-start", textTransform: "none" }}
              >
                Clear Terminal
              </Button>
            </Stack>
          </Box>
        </Stack>
      </Popover>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          bgcolor: "background.default",
          display: windowState.minimized ? "none" : "block"
        }}
      >
        <Box
          ref={terminalRef}
          sx={{
            width: "100%",
            height: "100%",
            bgcolor: "background.default",
            color: "text.primary",
            overflow: "hidden"
          }}
        />
      </Box>
    </Paper>
  );
}

const MemoTerminalWindow = React.memo(
  TerminalWindow,
  (previousProps, nextProps) =>
    previousProps.windowState === nextProps.windowState &&
    previousProps.terminalPreferences === nextProps.terminalPreferences &&
    previousProps.onSaveTerminalPreferences === nextProps.onSaveTerminalPreferences
);

export function RuntimeTerminalWindows(props: {
  onSaveTerminalPreferences: (
    next: TerminalPreferences,
    options?: {
      notify?: boolean;
    }
  ) => void;
  terminalPreferences: TerminalPreferences;
}) {
  const terminals = useRuntimeUiStore((state) => state.terminals);
  return (
    <>
      {terminals.map((terminal) => (
        <MemoTerminalWindow
          key={terminal.id}
          onSaveTerminalPreferences={props.onSaveTerminalPreferences}
          terminalPreferences={props.terminalPreferences}
          windowState={terminal}
        />
      ))}
    </>
  );
}
