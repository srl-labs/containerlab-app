import { Alert, Loader, Paper, Stack, Text } from "@mantine/core";
import React from "react";
import { createRoot } from "react-dom/client";

import { ClabUiRuntimeProvider, type ClabUiRuntime } from "../../host";
import { AppThemeProvider } from "@srl-labs/clab-ui/theme";
import { useMessageListener, usePostMessage } from "../shared/hooks";

import type { WiresharkVncInitialData } from "./types";

type WiresharkVncOutgoingMessage = { type: "retry-check" };

interface VncProgressMessage {
  type: "vnc-progress";
  attempt?: number;
  maxAttempts?: number;
}

interface VncReadyMessage {
  type: "vnc-ready";
  url?: string;
}

interface VncTimeoutMessage {
  type: "vnc-timeout";
  url?: string;
}

type WiresharkVncIncomingMessage = VncProgressMessage | VncReadyMessage | VncTimeoutMessage;

function appendCacheBuster(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}t=${Date.now()}`;
}

export function WiresharkVncApp(): React.JSX.Element {
  const initialData = (window.__INITIAL_DATA__ ?? {}) as unknown as WiresharkVncInitialData;
  const fallbackUrl = initialData.iframeUrl || "";
  const showVolumeTip = Boolean(initialData.showVolumeTip);

  const postMessage = usePostMessage<WiresharkVncOutgoingMessage>();

  const latestUrlRef = React.useRef(fallbackUrl);
  const pendingRetryRef = React.useRef(false);

  const [isLoading, setIsLoading] = React.useState(true);
  const [isFrameVisible, setIsFrameVisible] = React.useState(false);
  const [iframeSrc, setIframeSrc] = React.useState("");
  const [retryInfo, setRetryInfo] = React.useState("");

  const loadVnc = React.useCallback(
    (url?: string, forceReload = false) => {
      const nextUrl = (url || latestUrlRef.current || fallbackUrl).trim();
      if (!nextUrl) {
        return;
      }

      latestUrlRef.current = nextUrl;
      const targetUrl = forceReload ? appendCacheBuster(nextUrl) : nextUrl;
      setIsLoading(true);
      setIsFrameVisible(false);
      setIframeSrc(targetUrl);
    },
    [fallbackUrl]
  );

  useMessageListener<WiresharkVncIncomingMessage>((message) => {
    if (!message || typeof message !== "object" || !("type" in message)) {
      return;
    }

    switch (message.type) {
      case "vnc-progress": {
        pendingRetryRef.current = false;
        const attempt = typeof message.attempt === "number" ? message.attempt : 0;
        const maxAttempts = typeof message.maxAttempts === "number" ? message.maxAttempts : 0;

        if (attempt <= 1) {
          setRetryInfo("Waiting for VNC server...");
        } else if (maxAttempts > 0) {
          setRetryInfo(`Waiting for VNC server... (attempt ${attempt}/${maxAttempts})`);
        } else {
          setRetryInfo(`Waiting for VNC server... (attempt ${attempt})`);
        }

        break;
      }
      case "vnc-ready": {
        pendingRetryRef.current = false;
        setRetryInfo("VNC server ready, loading...");
        loadVnc(message.url, false);
        break;
      }
      case "vnc-timeout": {
        pendingRetryRef.current = false;
        setRetryInfo("Connection timeout - attempting to load anyway...");
        loadVnc(message.url, true);
        break;
      }
    }
  });

  React.useEffect(() => {
    postMessage({ type: "retry-check" });
  }, [postMessage]);

  return (
    <AppThemeProvider>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          backgroundColor: "var(--mantine-color-body)"
        }}
      >
        <iframe
          title="Wireshark VNC"
          src={iframeSrc || undefined}
          onLoad={() => {
            setIsLoading(false);
            setIsFrameVisible(true);
            setRetryInfo("");
            pendingRetryRef.current = false;
          }}
          onError={() => {
            setIsLoading(true);
            setIsFrameVisible(false);
            setRetryInfo("Connection failed - retrying...");

            if (!pendingRetryRef.current) {
              pendingRetryRef.current = true;
              postMessage({ type: "retry-check" });
            }
          }}
          style={{
            border: 0,
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            display: isFrameVisible ? "block" : "none"
          }}
        />

        {isLoading ? (
          <Stack
            align="center"
            justify="center"
            style={{
              position: "absolute",
              inset: 0,
              padding: 16,
              textAlign: "center"
            }}
          >
            <Paper withBorder style={{ paddingInline: 24, paddingBlock: 20, maxWidth: 460 }}>
              <Stack gap="sm" align="center">
                <Loader size={24} />
                <Text fw={500}>Loading Wireshark...</Text>
                {showVolumeTip ? (
                  <Alert color="blue" variant="outline" style={{ textAlign: "left" }}>
                    Tip: Save pcap files to `/pcaps` to persist them in the lab directory.
                  </Alert>
                ) : null}
                {retryInfo ? (
                  <Text size="xs" c="dimmed">
                    {retryInfo}
                  </Text>
                ) : null}
              </Stack>
            </Paper>
          </Stack>
        ) : null}
      </div>
    </AppThemeProvider>
  );
}

export function bootstrapWiresharkVncWebview(runtime: ClabUiRuntime): void {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Wireshark VNC root element not found");
  }

  const root = createRoot(container);
  root.render(
    <ClabUiRuntimeProvider runtime={runtime}>
      <React.StrictMode>
        <WiresharkVncApp />
      </React.StrictMode>
    </ClabUiRuntimeProvider>
  );
}
