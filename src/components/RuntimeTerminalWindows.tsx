import React, { useEffect, useMemo, useRef } from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import {
  Close as CloseIcon,
  Minimize as MinimizeIcon,
  OpenInFull as RestoreIcon
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
  loadTerminalPreferences,
  resolveTerminalSshUsername
} from "../runtimeTerminalSettings";
import type { ContainerState, LabState } from "../stores/labStore";
import { useLabStore } from "../stores/labStore";
import {
  runtimeUiActions,
  useRuntimeUiStore,
  type RuntimeTerminalWindow
} from "../stores/runtimeUiStore";
import { findLabStateForTopology } from "../standaloneHostShared";

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

function TerminalWindow({ windowState }: { windowState: RuntimeTerminalWindow }) {
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
    if (!terminalRef.current || xtermRef.current) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      scrollback: 5000,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
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
      if (windowState.minimized) {
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
  }, [windowState.id, windowState.minimized, windowState.nodeName, windowState.protocol]);

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
    fitAddonRef.current?.fit();
  }, [windowState.width, windowState.height, windowState.minimized]);

  useEffect(() => {
    if (windowState.state !== "creating" || xtermRef.current === null) {
      return;
    }

    let cancelled = false;
    const preferences = loadTerminalPreferences();
    const sshUsername =
      windowState.protocol === "ssh"
        ? resolveTerminalSshUsername(runtimeContainer?.kind, preferences)
        : undefined;
    const telnetPort = windowState.protocol === "telnet" ? preferences.telnetPort : undefined;
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

  return (
    <Paper
      ref={rootRef}
      elevation={10}
      onMouseDown={() => runtimeUiActions.focusTerminal(windowState.id)}
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
          <IconButton
            size="small"
            onClick={() => runtimeUiActions.setTerminalMinimized(windowState.id, !windowState.minimized)}
          >
            {windowState.minimized ? <RestoreIcon fontSize="inherit" /> : <MinimizeIcon fontSize="inherit" />}
          </IconButton>
          <IconButton size="small" onClick={handleClose}>
            <CloseIcon fontSize="inherit" />
          </IconButton>
        </Stack>
      </Box>
      {!windowState.minimized ? (
        <Box sx={{ flex: 1, minHeight: 0, bgcolor: "background.default" }}>
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
      ) : null}
    </Paper>
  );
}

const MemoTerminalWindow = React.memo(
  TerminalWindow,
  (previousProps, nextProps) => previousProps.windowState === nextProps.windowState
);

export function RuntimeTerminalWindows() {
  const terminals = useRuntimeUiStore((state) => state.terminals);
  return (
    <>
      {terminals.map((terminal) => (
        <MemoTerminalWindow key={terminal.id} windowState={terminal} />
      ))}
    </>
  );
}
