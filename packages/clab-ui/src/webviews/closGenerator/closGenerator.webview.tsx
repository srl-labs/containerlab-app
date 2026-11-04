// The Clos topology wizard as a page, for hosts without workspace dialogs (VS Code).
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import React from "react";
import { createRoot } from "react-dom/client";

import { ClabUiRuntimeProvider, type ClabUiRuntime } from "../../host";
import { ClosGeneratorFields, useClosGeneratorForm } from "../../lab-tools/ClosGeneratorForm";
import { defaultClosDraft, type ClosGeneratorDraft, type ClosGeneratorResult } from "../../lab-tools/closGenerator";
import { MuiThemeProvider } from "../../theme/index";
import { useMessageListener, usePostMessage } from "../shared/hooks";

export interface ClosGeneratorInitialData {
  /** Where the lab will be generated, e.g. "This computer" or a lab host. */
  targetLabel?: string;
  draft?: ClosGeneratorDraft;
}

type ClosGeneratorOutgoingMessage =
  | { command: "generate"; data: ClosGeneratorResult }
  | { command: "cancel" };

/** The host reports progress and failures of the generate request. */
interface ClosGeneratorStatusMessage {
  command: "status";
  busy?: boolean;
  error?: string;
}

export function ClosGeneratorApp(): React.JSX.Element {
  const initialData = (window.__INITIAL_DATA__ ?? {}) as unknown as ClosGeneratorInitialData;
  const form = useClosGeneratorForm(initialData.draft ?? defaultClosDraft());
  const postMessage = usePostMessage<ClosGeneratorOutgoingMessage>();
  const [status, setStatus] = React.useState<{ busy: boolean; error?: string }>({ busy: false });

  useMessageListener<ClosGeneratorStatusMessage>((message) => {
    if (message.command === "status") setStatus({ busy: message.busy === true, error: message.error });
  });

  const submit = () => {
    const result = form.submit();
    if (!result) return;
    setStatus({ busy: true });
    postMessage({ command: "generate", data: result });
  };

  return (
    <MuiThemeProvider>
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default", overflow: "auto" }}>
        <Box sx={{ maxWidth: 720, mx: "auto", px: 3, py: 2.5, display: "flex", flexDirection: "column", gap: 2 }}>
          <Box>
            <Typography variant="h6">Generate Clos topology</Typography>
            {initialData.targetLabel ? (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                On {initialData.targetLabel}
              </Typography>
            ) : null}
          </Box>
          <ClosGeneratorFields form={form} error={status.error} />
          <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
            <Button variant="text" size="small" onClick={() => postMessage({ command: "cancel" })}>
              Cancel
            </Button>
            <Button size="small" onClick={submit} disabled={status.busy} data-testid="clos-generator-submit">
              {status.busy ? "Generating…" : "Generate"}
            </Button>
          </Box>
        </Box>
      </Box>
    </MuiThemeProvider>
  );
}

export function bootstrapClosGeneratorWebview(runtime: ClabUiRuntime): void {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Clos generator root element not found");
  }
  createRoot(container).render(
    <ClabUiRuntimeProvider runtime={runtime}>
      <React.StrictMode>
        <ClosGeneratorApp />
      </React.StrictMode>
    </ClabUiRuntimeProvider>
  );
}
