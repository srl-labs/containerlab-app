import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Popover,
  Slider,
  Stack,
  Tooltip,
  Typography
} from "@mui/material";
import ActionsIcon from "@mui/icons-material/Tune";
import ClearIcon from "@mui/icons-material/CleaningServices";
import CloseIcon from "@mui/icons-material/Close";
import CopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import ExportLogIcon from "@mui/icons-material/Subject";
import MinimizeIcon from "@mui/icons-material/Minimize";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ResetIcon from "@mui/icons-material/RestartAlt";
import RestoreIcon from "@mui/icons-material/OpenInFull";
import SplitIcon from "@mui/icons-material/ViewColumn";
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
import { buildDetachedTerminalUrl } from "../runtimeDetachedTerminal";
import type { ContainerState, LabState } from "../stores/labStore";
import { useLabStore } from "../stores/labStore";
import {
  runtimeUiActions,
  useRuntimeUiStore,
  type RuntimeTerminalGroup,
  type RuntimeTerminalPane,
  type RuntimeTerminalShell
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
    topologyRef?: RuntimeTerminalPane["topologyRef"];
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

type TerminalSocketPayload = {
  data?: string;
  encoding?: string;
  error?: string;
  exitCode?: number | null;
  type?: string;
};

function sendTerminalResize(socket: WebSocket, terminal: Terminal | null): void {
  if (socket.readyState !== WebSocket.OPEN || !terminal) {
    return;
  }
  socket.send(
    JSON.stringify({
      type: "resize",
      cols: terminal.cols,
      rows: terminal.rows
    })
  );
}

function handleTerminalSocketPayload(input: {
  fitAddon: FitAddon | null;
  payload: TerminalSocketPayload;
  socket: WebSocket;
  terminal: Terminal | null;
  paneId: string;
}): void {
  const { fitAddon, payload, socket, terminal, paneId } = input;
  switch (payload.type) {
    case "ready":
      runtimeUiActions.setTerminalReady(paneId);
      fitAddon?.fit();
      sendTerminalResize(socket, terminal);
      break;
    case "output":
      if (payload.data && payload.encoding === "base64" && terminal) {
        terminal.write(decodeBase64ToBytes(payload.data));
      }
      break;
    case "exit": {
      const errorMessage = typeof payload.error === "string" ? payload.error : undefined;
      terminal?.write(
        `\r\n[session ended${payload.exitCode !== undefined ? `: ${payload.exitCode}` : ""}]${
          errorMessage ? ` ${errorMessage}` : ""
        }\r\n`
      );
      runtimeUiActions.setTerminalExited(paneId, payload.exitCode, errorMessage);
      break;
    }
    case "error":
      if (payload.error) {
        terminal?.write(`\r\n[error] ${payload.error}\r\n`);
        runtimeUiActions.setTerminalError(paneId, payload.error);
      }
      break;
    default:
      break;
  }
}

function normalizeTerminalOutput(value: string): string {
  return value.replace(/\r?\n/g, "\r\n");
}

function terminalStatusDotColor(paneState: RuntimeTerminalPane | undefined): string {
  if (paneState?.state === "ready") {
    return "success.main";
  }
  if (paneState?.state === "error") {
    return "error.main";
  }
  if (paneState?.state === "exited") {
    return "warning.main";
  }
  return "text.disabled";
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

function hasTerminalDomFocus(root: HTMLDivElement | null): boolean {
  if (!root) {
    return false;
  }
  const activeElement = document.activeElement;
  return activeElement instanceof Node && root.contains(activeElement);
}

function activePaneForGroup(group: RuntimeTerminalGroup | undefined): RuntimeTerminalPane | undefined {
  return group?.panes.find((pane) => pane.id === group.activePaneId) ?? group?.panes[0];
}

function terminalPaneLabel(pane: RuntimeTerminalPane, index: number, count: number): string {
  return count > 1 ? `${index + 1}. ${pane.title}` : pane.title;
}

function openDetachedTerminalWindow(paneState: RuntimeTerminalPane): void {
  const popup = window.open(buildDetachedTerminalUrl(paneState), "_blank", "noopener,noreferrer");
  if (!popup) {
    runtimeUiActions.notify("Browser blocked the terminal popup.", "warning");
  }
}

const FONT_SIZE_PERSIST_DELAY_MS = 220;

export function RuntimeTerminalPaneView({
  active,
  actionsAnchorElement,
  actionsOpen = false,
  hidden,
  onCloseActions,
  onSaveTerminalPreferences,
  paneState,
  popoverZIndex,
  terminalPreferences
}: {
  actionsAnchorElement?: HTMLElement | null;
  active: boolean;
  actionsOpen?: boolean;
  hidden: boolean;
  onCloseActions?: () => void;
  onSaveTerminalPreferences: (
    next: TerminalPreferences,
    options?: {
      notify?: boolean;
    }
  ) => void;
  paneState: RuntimeTerminalPane;
  popoverZIndex?: number;
  terminalPreferences: TerminalPreferences;
}) {
  const labs = useLabStore((state) => state.labs);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const websocketRef = useRef<WebSocket | null>(null);
  const latestPaneRef = useRef(paneState);
  const latestHiddenRef = useRef(hidden);
  const sessionClosedRef = useRef(false);
  const latestPreferencesRef = useRef(terminalPreferences);
  const fontSizePreviewRef = useRef(terminalPreferences.fontSize);
  const fontSizePersistTimerRef = useRef<number | null>(null);
  const [fontSizePreview, setFontSizePreview] = useState(terminalPreferences.fontSize);
  const isOutputTerminal = paneState.protocol === "output";

  const runtimeContainer = useMemo(
    () =>
      findRuntimeContainer(labs, {
        endpointId: paneState.endpointId,
        topologyRef: paneState.topologyRef,
        nodeName: paneState.nodeName
      }),
    [labs, paneState.endpointId, paneState.nodeName, paneState.topologyRef]
  );

  useEffect(() => {
    latestPaneRef.current = paneState;
  }, [paneState]);

  useEffect(() => {
    latestHiddenRef.current = hidden;
    if (!hidden) {
      const frame = window.requestAnimationFrame(() => {
        fitAddonRef.current?.fit();
        const socket = websocketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          sendTerminalResize(socket, xtermRef.current);
        }
      });
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [hidden]);

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
      cursorBlink: !isOutputTerminal,
      scrollback: 5000,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: terminalPreferences.fontSize,
      disableStdin: isOutputTerminal,
      theme: resolveTerminalTheme(terminalRef.current)
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);
    requestAnimationFrame(() => fitAddon.fit());
    if (isOutputTerminal) {
      const output = (paneState.initialOutput ?? "").trim();
      term.write(output.length > 0 ? `${normalizeTerminalOutput(output)}\r\n` : "No output returned.\r\n");
      runtimeUiActions.setTerminalReady(paneState.id);
    } else {
      term.write(`Opening ${paneState.protocol} terminal for ${paneState.nodeName}...\r\n`);
    }

    const dataDisposable = term.onData((data) => {
      if (isOutputTerminal) {
        return;
      }
      const socket = websocketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });

    const observer = new ResizeObserver(() => {
      if (latestHiddenRef.current) {
        return;
      }
      fitAddon.fit();
      const socket = websocketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        sendTerminalResize(socket, term);
      }
    });

    if (rootRef.current) {
      observer.observe(rootRef.current);
    }

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    return () => {
      dataDisposable.dispose();
      observer.disconnect();
      xtermRef.current?.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [
    isOutputTerminal,
    paneState.id,
    paneState.initialOutput,
    paneState.nodeName,
    paneState.protocol
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
    if (paneState.state !== "creating" || xtermRef.current === null) {
      return;
    }
    if (isOutputTerminal) {
      runtimeUiActions.setTerminalReady(paneState.id);
      return;
    }
    const sessionProtocol = paneState.protocol;
    if (sessionProtocol === "output") {
      runtimeUiActions.setTerminalReady(paneState.id);
      return;
    }

    let cancelled = false;
    const sshUsername =
      sessionProtocol === "ssh"
        ? resolveTerminalSshUsername(runtimeContainer?.kind, terminalPreferences)
        : undefined;
    const telnetPort = sessionProtocol === "telnet" ? terminalPreferences.telnetPort : undefined;
    const cols = xtermRef.current.cols || 120;
    const rows = xtermRef.current.rows || 36;

    void openTerminalSession({
      endpointId: paneState.endpointId,
      sessionId: paneState.sessionId,
      topologyRef: paneState.topologyRef,
      nodeName: paneState.nodeName,
      protocol: sessionProtocol,
      cols,
      rows,
      sshUsername,
      telnetPort
    })
      .then((session) => {
        if (cancelled) {
          void closeTerminalSession(session.sessionId, paneState.endpointId).catch(() => {});
          return;
        }
        runtimeUiActions.setTerminalSession(paneState.id, session.sessionId);
        runtimeUiActions.setTerminalConnecting(paneState.id);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        xtermRef.current?.write(`\r\n[error] ${message}\r\n`);
        runtimeUiActions.setTerminalError(paneState.id, message);
      });

    return () => {
      cancelled = true;
    };
  }, [
    isOutputTerminal,
    paneState.endpointId,
    paneState.id,
    paneState.nodeName,
    paneState.protocol,
    paneState.sessionId,
    paneState.state,
    paneState.topologyRef,
    runtimeContainer?.kind,
    terminalPreferences.sshUserMapping,
    terminalPreferences.telnetPort
  ]);

  useEffect(() => {
    if (!paneState.terminalSessionId || websocketRef.current || xtermRef.current === null) {
      return;
    }

    sessionClosedRef.current = false;
    const socket = connectTerminalSessionWebSocket(paneState.terminalSessionId, paneState.endpointId);
    websocketRef.current = socket;

    socket.onmessage = (event) => {
      try {
        handleTerminalSocketPayload({
          fitAddon: fitAddonRef.current,
          payload: JSON.parse(String(event.data)) as TerminalSocketPayload,
          socket,
          terminal: xtermRef.current,
          paneId: paneState.id
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtimeUiActions.setTerminalError(paneState.id, message);
      }
    };

    socket.onerror = () => {
      runtimeUiActions.setTerminalError(paneState.id, "Terminal connection failed.");
    };

    socket.onclose = () => {
      websocketRef.current = null;
      const latestPane = latestPaneRef.current;
      if (!sessionClosedRef.current && latestPane.state !== "exited" && latestPane.state !== "error") {
        runtimeUiActions.setTerminalExited(
          latestPane.id,
          latestPane.exitCode,
          latestPane.error ?? "Connection closed."
        );
      }
    };

    return () => {
      sessionClosedRef.current = true;
      socket.close();
      websocketRef.current = null;
    };
  }, [paneState.endpointId, paneState.id, paneState.terminalSessionId]);

  useEffect(() => {
    return () => {
      const sessionId = paneState.terminalSessionId;
      const socket = websocketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "close" }));
        socket.close();
      }
      if (sessionId) {
        void closeTerminalSession(sessionId, paneState.endpointId).catch(() => {});
      }
    };
  }, [paneState.endpointId, paneState.terminalSessionId]);

  useEffect(() => {
    return () => {
      if (fontSizePersistTimerRef.current !== null) {
        window.clearTimeout(fontSizePersistTimerRef.current);
        fontSizePersistTimerRef.current = null;
      }
    };
  }, []);

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
        nodeName: paneState.nodeName,
        protocol: paneState.protocol,
        scope
      });
      downloadTextFile(filename, content);
      runtimeUiActions.notify(
        scope === "screen" ? "Terminal screen exported." : "Terminal log exported.",
        "success"
      );
    },
    [paneState.nodeName, paneState.protocol]
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

  const handleTerminalWheelZoom = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!active || hidden || !hasTerminalDomFocus(rootRef.current)) {
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
    [active, handleFontSizeUpdate, hidden]
  );

  const syncTerminalSizeToSession = useCallback(() => {
    const term = xtermRef.current;
    if (!term || hidden) {
      return;
    }
    fitAddonRef.current?.fit();
    const socket = websocketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      sendTerminalResize(socket, term);
    }
  }, [hidden]);

  useEffect(() => {
    if (!active || hidden) {
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
  }, [active, handleFontSizeUpdate, hidden]);

  useEffect(() => {
    if (hidden) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      syncTerminalSizeToSession();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [hidden, syncTerminalSizeToSession]);

  return (
    <Box
      ref={rootRef}
      onMouseDown={() => runtimeUiActions.activateTerminalPane(paneState.id)}
      onWheel={handleTerminalWheelZoom}
      data-testid="runtime-terminal-pane"
      sx={{
        borderLeft: 1,
        borderColor: "divider",
        boxShadow: active ? "inset 2px 0 0 var(--clab-ui-focus-border, #1976d2)" : "none",
        display: hidden ? "none" : "flex",
        flex: 1,
        flexDirection: "column",
        minHeight: 0,
        minWidth: 280,
        overflow: "hidden"
      }}
    >
      <Popover
        open={actionsOpen && !hidden}
        anchorEl={actionsAnchorElement}
        onClose={onCloseActions}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        disableRestoreFocus
        slotProps={{
          root: {
            sx: {
              zIndex: popoverZIndex ?? 2500
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
          bgcolor: "background.default"
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
    </Box>
  );
}

const MemoTerminalPaneView = React.memo(
  RuntimeTerminalPaneView,
  (previousProps, nextProps) =>
    previousProps.active === nextProps.active &&
    previousProps.actionsAnchorElement === nextProps.actionsAnchorElement &&
    previousProps.actionsOpen === nextProps.actionsOpen &&
    previousProps.hidden === nextProps.hidden &&
    previousProps.paneState === nextProps.paneState &&
    previousProps.popoverZIndex === nextProps.popoverZIndex &&
    previousProps.terminalPreferences === nextProps.terminalPreferences &&
    previousProps.onSaveTerminalPreferences === nextProps.onSaveTerminalPreferences
);

function TerminalShell({
  onSaveTerminalPreferences,
  shell,
  terminalPreferences,
  terminals
}: {
  onSaveTerminalPreferences: (
    next: TerminalPreferences,
    options?: {
      notify?: boolean;
    }
  ) => void;
  shell: RuntimeTerminalShell;
  terminalPreferences: TerminalPreferences;
  terminals: RuntimeTerminalGroup[];
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const latestShellRef = useRef(shell);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    nextX: number;
    nextY: number;
    frameId: number | null;
  } | null>(null);
  const activeTerminalGroupId = useRuntimeUiStore((state) => state.activeTerminalGroupId);
  const [actionsAnchorElement, setActionsAnchorElement] = useState<HTMLElement | null>(null);
  const activeGroup = terminals.find((group) => group.id === activeTerminalGroupId) ?? terminals.at(-1);
  const activePane = activePaneForGroup(activeGroup);
  const actionsPopoverOpen = actionsAnchorElement !== null;

  useEffect(() => {
    latestShellRef.current = shell;
  }, [shell]);

  const handleHeaderMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (shell.minimized) {
      runtimeUiActions.setTerminalMinimized(shell.id, false);
    }
    runtimeUiActions.focusTerminal(shell.id);
    const latestShell = latestShellRef.current;
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: latestShell.x,
      originY: latestShell.y,
      nextX: latestShell.x,
      nextY: latestShell.y,
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
        runtimeUiActions.updateTerminalLayout(shell.id, {
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

  const handleOpenActions = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      consumeToolbarMouseEvent(event);
      if (activePane) {
        runtimeUiActions.activateTerminalPane(activePane.id);
      }
      setActionsAnchorElement(event.currentTarget);
    },
    [activePane]
  );

  const handleCloseActions = useCallback(() => {
    setActionsAnchorElement(null);
  }, []);

  const handleToggleMinimized = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      consumeToolbarMouseEvent(event);
      runtimeUiActions.setTerminalMinimized(shell.id, !shell.minimized);
    },
    [shell.id, shell.minimized]
  );

  const handleCloseShell = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    consumeToolbarMouseEvent(event);
    runtimeUiActions.closeAllTerminals();
  }, []);

  useEffect(() => {
    setActionsAnchorElement(null);
  }, [activePane?.id, shell.minimized]);

  return (
    <Paper
      ref={rootRef}
      elevation={10}
      onMouseDown={() => runtimeUiActions.focusTerminal(shell.id)}
      data-testid="runtime-terminal-window"
      sx={{
        position: "fixed",
        left: shell.x,
        top: shell.y,
        width: shell.width,
        height: shell.minimized ? "auto" : shell.height,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        resize: shell.minimized ? "none" : "both",
        zIndex: shell.zIndex,
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        backfaceVisibility: "hidden",
        contain: "layout paint",
        minWidth: 520,
        minHeight: shell.minimized ? 0 : 280
      }}
    >
      <Box
        onMouseDown={handleHeaderMouseDown}
        sx={{
          cursor: "move",
          px: 1,
          py: 0.625,
          borderBottom: shell.minimized ? 0 : 1,
          borderColor: "divider",
          bgcolor: "action.hover",
          userSelect: "none"
        }}
      >
        <Stack direction="row" alignItems="center" spacing={0.75}>
          <Stack sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 700,
                letterSpacing: 0,
                lineHeight: 1.2,
                textTransform: "uppercase"
              }}
              noWrap
            >
              Terminal
            </Typography>
            {activePane ? (
              <Typography variant="caption" sx={{ opacity: 0.7, lineHeight: 1.2 }} noWrap>
                {activePane.title}
              </Typography>
            ) : null}
          </Stack>
          <Tooltip title="Terminal Actions">
            <span>
              <Button
                size="small"
                variant="text"
                startIcon={<ActionsIcon fontSize="small" />}
                disabled={!activePane}
                onMouseDown={consumeToolbarMouseEvent}
                onClick={handleOpenActions}
                data-testid="runtime-terminal-actions-button"
                aria-label="Open terminal actions"
                sx={{ minWidth: 0, px: 0.75, py: 0.25, textTransform: "none" }}
              >
                Actions
              </Button>
            </span>
          </Tooltip>
          <Tooltip title="Open Active Terminal in New Window">
            <span>
              <IconButton
                size="small"
                disabled={!activePane}
                onMouseDown={consumeToolbarMouseEvent}
                onClick={() => activePane && openDetachedTerminalWindow(activePane)}
                data-testid="runtime-terminal-detach"
                aria-label="Open active terminal in new window"
              >
                <OpenInNewIcon fontSize="inherit" />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton
            size="small"
            onMouseDown={consumeToolbarMouseEvent}
            onClick={handleToggleMinimized}
            aria-label={shell.minimized ? "Restore terminal shell" : "Minimize terminal shell"}
            data-testid="runtime-terminal-minimize-shell"
          >
            {shell.minimized ? <RestoreIcon fontSize="inherit" /> : <MinimizeIcon fontSize="inherit" />}
          </IconButton>
          <Tooltip title="Close Terminal Window">
            <IconButton
              size="small"
              onMouseDown={consumeToolbarMouseEvent}
              onClick={handleCloseShell}
              aria-label="Close terminal window"
              data-testid="runtime-terminal-close-shell"
            >
              <CloseIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          bgcolor: "background.default",
          display: shell.minimized ? "none" : "flex"
        }}
      >
        <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
          {terminals.map((group) => {
            const groupActive = group.id === activeGroup?.id;
            return (
              <Box
                key={group.id}
                data-testid="runtime-terminal-tab-panel"
                sx={{
                  display: groupActive ? "flex" : "none",
                  flexDirection: "row",
                  height: "100%",
                  minHeight: 0,
                  overflow: "hidden"
                }}
              >
                {group.panes.map((pane) => (
                  <MemoTerminalPaneView
                    key={pane.id}
                    actionsAnchorElement={actionsAnchorElement}
                    actionsOpen={actionsPopoverOpen && groupActive && pane.id === group.activePaneId}
                    active={groupActive && pane.id === group.activePaneId}
                    hidden={!groupActive || shell.minimized}
                    onCloseActions={handleCloseActions}
                    onSaveTerminalPreferences={onSaveTerminalPreferences}
                    paneState={pane}
                    popoverZIndex={Math.max(shell.zIndex + 20, 2500)}
                    terminalPreferences={terminalPreferences}
                  />
                ))}
              </Box>
            );
          })}
        </Box>
        <Box
          role="tablist"
          aria-label="Open terminal tabs"
          data-testid="runtime-terminal-tabs"
          onMouseDown={consumeToolbarMouseEvent}
          sx={{
            bgcolor: "background.paper",
            borderLeft: 1,
            borderColor: "divider",
            display: "flex",
            flex: "0 0 236px",
            flexDirection: "column",
            minHeight: 0,
            overflowY: "auto",
            p: 0.5
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontWeight: 700,
              letterSpacing: 0,
              lineHeight: 1.3,
              px: 0.75,
              py: 0.5,
              textTransform: "uppercase"
            }}
          >
            Terminals
          </Typography>
          <Stack spacing={0.25} sx={{ minHeight: 0 }}>
            {terminals.map((group) => {
              const selected = group.id === activeGroup?.id;
              const groupActivePane = activePaneForGroup(group);
              return (
                <Box key={group.id}>
                  <Box
                    role="tab"
                    aria-selected={selected}
                    data-testid={`runtime-terminal-tab-${group.id}`}
                    onClick={() => runtimeUiActions.activateTerminalGroup(group.id)}
                    sx={{
                      alignItems: "center",
                      borderLeft: 2,
                      borderLeftColor: selected ? "primary.main" : "transparent",
                      borderRadius: 0.75,
                      bgcolor: selected ? "action.selected" : "transparent",
                      color: selected ? "text.primary" : "text.secondary",
                      cursor: "pointer",
                      display: "flex",
                      gap: 0.25,
                      height: 30,
                      minWidth: 0,
                      px: 0.5
                    }}
                  >
                    <Box
                      sx={{
                        bgcolor: terminalStatusDotColor(groupActivePane),
                        borderRadius: "50%",
                        flex: "0 0 auto",
                        height: 7,
                        width: 7
                      }}
                    />
                    <Typography
                      variant="caption"
                      title={group.title}
                      sx={{ flex: 1, fontWeight: selected ? 700 : 500, minWidth: 0 }}
                      noWrap
                    >
                      {group.title}
                      {group.panes.length > 1 ? ` (${group.panes.length})` : ""}
                    </Typography>
                    <Tooltip title="Split Terminal">
                      <IconButton
                        size="small"
                        onMouseDown={consumeToolbarMouseEvent}
                        onClick={(event) => {
                          event.stopPropagation();
                          runtimeUiActions.activateTerminalGroup(group.id);
                          const pane = activePaneForGroup(group);
                          if (pane) {
                            runtimeUiActions.splitTerminal(pane.id);
                          }
                        }}
                        aria-label={`Split ${group.title}`}
                        data-testid="runtime-terminal-tab-split"
                        sx={{ height: 22, width: 22 }}
                      >
                        <SplitIcon fontSize="inherit" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Kill Terminal">
                      <IconButton
                        size="small"
                        onMouseDown={consumeToolbarMouseEvent}
                        onClick={(event) => {
                          event.stopPropagation();
                          runtimeUiActions.closeTerminal(group.id);
                        }}
                        aria-label={`Kill ${group.title}`}
                        data-testid="runtime-terminal-tab-kill"
                        sx={{ height: 22, width: 22 }}
                      >
                        <CloseIcon fontSize="inherit" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {group.panes.length > 1 ? (
                    <Stack
                      spacing={0.25}
                      sx={{
                        borderLeft: 1,
                        borderColor: "divider",
                        ml: 1,
                        mt: 0.25,
                        pl: 0.5
                      }}
                    >
                      {group.panes.map((pane, paneIndex) => {
                        const paneSelected = selected && pane.id === group.activePaneId;
                        const paneLabel = terminalPaneLabel(pane, paneIndex, group.panes.length);
                        return (
                          <Box
                            key={pane.id}
                            role="button"
                            data-testid={`runtime-terminal-split-pane-${pane.id}`}
                            onClick={() => runtimeUiActions.activateTerminalPane(pane.id)}
                            sx={{
                              alignItems: "center",
                              borderRadius: 0.75,
                              bgcolor: paneSelected ? "action.selected" : "transparent",
                              color: paneSelected ? "text.primary" : "text.secondary",
                              cursor: "pointer",
                              display: "flex",
                              gap: 0.25,
                              height: 28,
                              minWidth: 0,
                              px: 0.5
                            }}
                          >
                            <Box
                              sx={{
                                bgcolor: terminalStatusDotColor(pane),
                                borderRadius: "50%",
                                flex: "0 0 auto",
                                height: 6,
                                width: 6
                              }}
                            />
                            <Typography
                              variant="caption"
                              title={pane.title}
                              sx={{
                                flex: 1,
                                fontWeight: paneSelected ? 700 : 500,
                                minWidth: 0
                              }}
                              noWrap
                            >
                              {paneLabel}
                            </Typography>
                            <Tooltip title="Close Split">
                              <IconButton
                                size="small"
                                onMouseDown={consumeToolbarMouseEvent}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  runtimeUiActions.closeTerminal(pane.id);
                                }}
                                aria-label={`Close ${paneLabel}`}
                                data-testid="runtime-terminal-split-pane-kill"
                                sx={{ height: 20, width: 20 }}
                              >
                                <CloseIcon fontSize="inherit" />
                              </IconButton>
                            </Tooltip>
                          </Box>
                        );
                      })}
                    </Stack>
                  ) : null}
                </Box>
              );
            })}
          </Stack>
        </Box>
      </Box>
    </Paper>
  );
}

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
  const shell = useRuntimeUiStore((state) => state.terminalShell);

  if (terminals.length === 0) {
    return null;
  }

  return (
    <TerminalShell
      onSaveTerminalPreferences={props.onSaveTerminalPreferences}
      shell={shell}
      terminalPreferences={props.terminalPreferences}
      terminals={terminals}
    />
  );
}
