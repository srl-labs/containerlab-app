import React, { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { ENDPOINT_EXPORT_FILENAME, DEFAULT_ENDPOINT_SESSION_DURATION, isValidEndpointSessionDuration } from "../endpoints";
import type { EndpointImportResult, EndpointSessionDuration } from "../types";
export function LoadingScreen() {
  return (
    <div style={{
      alignItems: "center",
      background: "var(--clab-ui-editor-background, #1e1e1e)",
      color: "var(--clab-ui-editor-foreground, #d4d4d4)",
      display: "flex",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      height: "100vh",
      justifyContent: "center"
    }}>
      containerlab
    </div>
  );
}

const loginStyles = {
  page: {
    alignItems: "center",
    background: "radial-gradient(ellipse at 50% 0%, rgba(60, 190, 239, 0.08) 0%, transparent 60%), var(--clab-ui-editor-background, #1e1e1e)",
    boxSizing: "border-box",
    color: "var(--clab-ui-editor-foreground, #cccccc)",
    display: "flex",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    justifyContent: "center",
    minHeight: "100vh",
    padding: 16
  },
  panel: {
    background: "var(--clab-ui-panel-background, #252526)",
    border: "1px solid var(--clab-ui-panel-border, #3c3c3c)",
    borderRadius: 8,
    boxShadow: "0 18px 50px rgba(0, 0, 0, 0.35)",
    boxSizing: "border-box",
    maxWidth: 520,
    padding: 32,
    width: "100%"
  },
  heading: {
    fontSize: 18,
    fontWeight: 600,
    margin: "0 0 4px"
  },
  copy: {
    color: "var(--vscode-descriptionForeground, #9d9d9d)",
    fontSize: 14,
    lineHeight: 1.45,
    margin: "0 0 24px",
    textAlign: "center"
  },
  form: {
    display: "grid",
    gap: 14
  },
  field: {
    display: "grid",
    gap: 6
  },
  label: {
    color: "var(--clab-ui-editor-foreground, #cccccc)",
    fontSize: 13,
    fontWeight: 500
  },
  input: {
    background: "var(--clab-ui-editor-background, #1e1e1e)",
    border: "1px solid var(--clab-ui-input-border, #4a4a4a)",
    borderRadius: 4,
    boxSizing: "border-box",
    color: "var(--clab-ui-input-foreground, #f0f0f0)",
    font: "inherit",
    height: 40,
    outline: "none",
    padding: "0 11px",
    width: "100%"
  },
  helper: {
    color: "var(--vscode-descriptionForeground, #9d9d9d)",
    fontSize: 12,
    lineHeight: 1.35,
    margin: 0
  },
  error: {
    border: "1px solid #f48771",
    borderRadius: 4,
    color: "#f4b8ad",
    fontSize: 13,
    lineHeight: 1.4,
    margin: "0 0 16px",
    padding: "8px 10px"
  },
  success: {
    border: "1px solid #73c991",
    borderRadius: 4,
    color: "#b7e1c1",
    fontSize: 13,
    lineHeight: 1.4,
    margin: "0 0 16px",
    padding: "8px 10px"
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
    marginBottom: 18
  },
  button: {
    alignSelf: "start",
    background: "var(--clab-ui-button-background, #0e639c)",
    border: "1px solid #1177bb",
    borderRadius: 4,
    color: "var(--clab-ui-button-foreground, #ffffff)",
    cursor: "pointer",
    font: "inherit",
    fontWeight: 600,
    minHeight: 38,
    padding: "0 16px"
  },
  secondaryButton: {
    background: "transparent",
    border: "1px solid var(--clab-ui-input-border, #4a4a4a)",
    borderRadius: 4,
    color: "var(--clab-ui-editor-foreground, #cccccc)",
    cursor: "pointer",
    font: "inherit",
    fontWeight: 600,
    minHeight: 34,
    padding: "0 12px"
  },
  buttonDisabled: {
    cursor: "not-allowed",
    opacity: 0.48
  }
} satisfies Record<string, CSSProperties>;

function pickEndpointImportFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.position = "fixed";
    input.style.left = "-9999px";

    let settled = false;
    const cleanup = (file: File | null) => {
      if (settled) {
        return;
      }
      settled = true;
      input.removeEventListener("change", handleChange);
      input.removeEventListener("cancel", handleCancel);
      input.remove();
      resolve(file);
    };
    const handleChange = () => cleanup(input.files?.[0] ?? null);
    const handleCancel = () => cleanup(null);

    input.addEventListener("change", handleChange, { once: true });
    input.addEventListener("cancel", handleCancel, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

function downloadEndpointExport(content: string): void {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = ENDPOINT_EXPORT_FILENAME;
  link.click();
  URL.revokeObjectURL(url);
}

function formatEndpointImportResult(result: EndpointImportResult): string {
  if (result.total === 0) {
    return "No endpoint profiles were found in the import file.";
  }
  return `Imported ${result.total} endpoint ${result.total === 1 ? "profile" : "profiles"}.`;
}

export function BootstrapLoginPage(props: {
  defaultApiUrl: string;
  error: string | null;
  onAddEndpoint: (input: {
    label?: string;
    password: string;
    sessionDuration: EndpointSessionDuration;
    url: string;
    username: string;
  }) => Promise<void>;
  onExportEndpoints: () => string;
  onImportEndpoints: (content: string) => EndpointImportResult;
}) {
  const { defaultApiUrl, error, onAddEndpoint, onExportEndpoints, onImportEndpoints } = props;
  const [url, setUrl] = useState(defaultApiUrl);
  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sessionDuration, setSessionDuration] = useState<EndpointSessionDuration>(
    DEFAULT_ENDPOINT_SESSION_DURATION
  );
  const [busy, setBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!url.trim() && defaultApiUrl.trim()) {
      setUrl(defaultApiUrl);
    }
  }, [defaultApiUrl, url]);

  const sessionDurationValid = isValidEndpointSessionDuration(sessionDuration);
  const submitDisabled =
    busy || importBusy || !url.trim() || !username.trim() || !password.trim() || !sessionDurationValid;
  const visibleError = localError ?? error;

  const submit = useCallback(async () => {
    if (submitDisabled) {
      return;
    }

    setBusy(true);
    setLocalError(null);
    setNotice(null);
    try {
      await onAddEndpoint({
        url: url.trim(),
        label: label.trim() || undefined,
        username: username.trim(),
        password,
        sessionDuration
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [label, onAddEndpoint, password, sessionDuration, submitDisabled, url, username]);

  const handleImportEndpoints = useCallback(async () => {
    if (importBusy) {
      return;
    }

    setImportBusy(true);
    setLocalError(null);
    setNotice(null);
    try {
      const file = await pickEndpointImportFile();
      if (!file) {
        return;
      }
      setNotice(formatEndpointImportResult(onImportEndpoints(await file.text())));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setImportBusy(false);
    }
  }, [importBusy, onImportEndpoints]);

  const handleExportEndpoints = useCallback(() => {
    setLocalError(null);
    setNotice(null);
    try {
      downloadEndpointExport(onExportEndpoints());
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  }, [onExportEndpoints]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  }, [submit]);

  return (
    <div style={loginStyles.page}>
      <section style={loginStyles.panel} aria-label="Containerlab endpoint login">
        <p style={loginStyles.copy}>
          Connect one or more `clab-api-server` endpoints to manage labs in the browser.
        </p>
        <h1 style={loginStyles.heading}>Add Endpoint</h1>
        <p style={{ ...loginStyles.helper, marginBottom: 18 }}>
          Authenticate against a clab-api-server to start or restore the standalone session.
        </p>
        <div style={loginStyles.actions}>
          <button
            data-testid="standalone-endpoints-import"
            disabled={importBusy}
            onClick={() => {
              void handleImportEndpoints();
            }}
            style={{
              ...loginStyles.secondaryButton,
              ...(importBusy ? loginStyles.buttonDisabled : {})
            }}
            type="button"
          >
            {importBusy ? "Importing..." : "Import"}
          </button>
          <button
            data-testid="standalone-endpoints-export"
            onClick={handleExportEndpoints}
            style={loginStyles.secondaryButton}
            type="button"
          >
            Export
          </button>
        </div>

        {visibleError ? (
          <div role="alert" style={loginStyles.error}>
            {visibleError}
          </div>
        ) : null}
        {notice ? (
          <div role="status" style={loginStyles.success}>
            {notice}
          </div>
        ) : null}

        <form style={loginStyles.form} onSubmit={handleSubmit}>
          <label style={loginStyles.field}>
            <span style={loginStyles.label}>API Endpoint</span>
            <input
              aria-label="API Endpoint"
              placeholder="https://localhost:8090"
              style={loginStyles.input}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label style={loginStyles.field}>
            <span style={loginStyles.label}>Label</span>
            <input
              aria-label="Label"
              placeholder="Optional friendly name"
              style={loginStyles.input}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <label style={loginStyles.field}>
            <span style={loginStyles.label}>Username</span>
            <input
              aria-label="Username"
              style={loginStyles.input}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label style={loginStyles.field}>
            <span style={loginStyles.label}>Password</span>
            <input
              aria-label="Password"
              style={loginStyles.input}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label style={loginStyles.field}>
            <span style={loginStyles.label}>Keep me signed in</span>
            <input
              aria-label="Keep me signed in"
              placeholder="24h"
              style={{
                ...loginStyles.input,
                borderColor: sessionDuration.trim() && !sessionDurationValid ? "#f48771" : "var(--clab-ui-input-border, #4a4a4a)"
              }}
              value={sessionDuration}
              onChange={(event) => setSessionDuration(event.target.value)}
            />
            <span style={loginStyles.helper}>
              {sessionDurationValid
                ? "Examples: 24h, 36h, 7d, 1h30m"
                : "Use values like 24h, 36h, 7d, or 1h30m"}
            </span>
          </label>
          <button
            disabled={submitDisabled}
            style={{
              ...loginStyles.button,
              ...(submitDisabled ? loginStyles.buttonDisabled : {})
            }}
            type="submit"
          >
            {busy ? "Adding..." : "Add Endpoint"}
          </button>
        </form>
      </section>
    </div>
  );
}
