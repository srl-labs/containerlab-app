import React, { useCallback, useEffect, useState, type FormEvent } from "react";
import { ENDPOINT_EXPORT_FILENAME, DEFAULT_ENDPOINT_SESSION_DURATION, isValidEndpointSessionDuration } from "../endpoints";
import type { EndpointImportResult, EndpointSessionDuration } from "../types";
import { controlRadius, dialogRadius, overlayShadow } from "../../theme/surfaces";
import { UI_FONT_FAMILY } from "../../theme/typography";

/** Matches the host page's startup screen so loading does not flash a different design. */
export function LoadingScreen({ logoUrl }: { logoUrl?: string }) {
  return (
    <div data-testid="workspace-loading" style={{
      alignItems: "center",
      background: "var(--clab-ui-editor-background, #000000)",
      color: "var(--clab-ui-editor-foreground, #ececec)",
      display: "flex",
      fontFamily: UI_FONT_FAMILY,
      height: "100%",
      justifyContent: "center"
    }}>
      {logoUrl ? <img src={logoUrl} alt="Containerlab" width={136} height={136} /> : "containerlab"}
    </div>
  );
}

const LOGIN_CSS = `
.clab-login {
  --login-card: var(--clab-ui-panel-background, var(--vscode-sideBar-background));
  --login-border: var(--clab-ui-panel-border, var(--vscode-panel-border));
  --login-muted: var(--vscode-descriptionForeground);
  --login-focus: var(--clab-ui-focus-border, var(--vscode-focusBorder));
  align-items: center; box-sizing: border-box; display: flex; justify-content: center;
  min-height: 100%; padding: 24px 16px;
  background:
    radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--login-focus) 10%, transparent), transparent 60%),
    var(--clab-ui-editor-background, var(--vscode-editor-background));
  color: var(--clab-ui-editor-foreground, var(--vscode-foreground));
  font-family: ${UI_FONT_FAMILY}; font-size: 13px; line-height: 1.5;
}
.clab-login *, .clab-login *::before, .clab-login *::after { box-sizing: border-box; }
.clab-login-card {
  background: var(--login-card); border: 1px solid var(--login-border); border-radius: ${dialogRadius};
  box-shadow: ${overlayShadow}; max-width: 420px; padding: 32px 32px 0; width: 100%;
}
.clab-login-logo { display: block; height: 40px; margin: 0 auto 16px; width: 40px; }
.clab-login-title { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; line-height: 1.3; margin: 0; text-align: center; }
.clab-login-copy { color: var(--login-muted); margin: 6px 0 24px; text-align: center; }
.clab-login-message { border: 1px solid; border-radius: ${controlRadius}; margin: 0 0 20px; padding: 8px 10px; }
.clab-login-message[role="alert"] {
  background: var(--vscode-inputValidation-errorBackground); border-color: var(--vscode-inputValidation-errorBorder);
}
.clab-login-message[role="status"] {
  background: color-mix(in srgb, var(--vscode-testing-iconPassed) 10%, transparent); border-color: var(--vscode-testing-iconPassed);
}
.clab-login-form { display: grid; gap: 18px; }
.clab-login-row { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
.clab-login-field { display: block; min-width: 0; position: relative; }
/* The label sits in a notch of the field's top border, like the app's other inputs. */
.clab-login-label {
  background: var(--login-card); color: var(--login-muted); font-size: 11px; left: 8px; line-height: 14px;
  padding: 0 4px; pointer-events: none; position: absolute; top: -7px; transition: color 120ms ease;
}
.clab-login-field:focus-within .clab-login-label { color: var(--login-focus); }
.clab-login-input {
  background: transparent; border: 1px solid var(--vscode-input-border, var(--login-border)); border-radius: ${controlRadius};
  color: var(--vscode-input-foreground, inherit); display: block; font: inherit; height: 34px; outline: none;
  padding: 0 11px; transition: border-color 120ms ease; width: 100%;
}
.clab-login-input::placeholder { color: var(--vscode-input-placeholderForeground); opacity: 1; }
.clab-login-input:focus { border-color: var(--login-focus); box-shadow: inset 0 0 0 0.5px var(--login-focus); }
.clab-login-input[aria-invalid="true"] { border-color: var(--vscode-inputValidation-errorBorder); }
.clab-login-helper { color: var(--login-muted); display: block; font-size: 11px; line-height: 1.45; margin: 4px 0 0 12px; }
.clab-login-input[aria-invalid="true"] + .clab-login-helper { color: var(--vscode-errorForeground); }
.clab-login-button {
  background: var(--clab-ui-button-background, var(--vscode-button-background)); border: 0; border-radius: ${controlRadius};
  color: var(--vscode-button-foreground); cursor: pointer; font: inherit; font-weight: 500; height: 34px; margin-top: 2px;
  padding: 0 16px; transition: background-color 120ms ease; width: 100%;
}
.clab-login-button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
.clab-login-footer {
  align-items: center; border-top: 1px solid var(--login-border); color: var(--login-muted); display: flex; gap: 4px;
  font-size: 12px; margin: 24px -32px 0; padding: 10px 24px 10px 32px;
}
.clab-login-footer > span { flex: 1; }
.clab-login-link {
  background: transparent; border: 0; border-radius: ${controlRadius}; color: inherit; cursor: pointer; font: inherit;
  height: 28px; padding: 0 10px; transition: background-color 120ms ease, color 120ms ease;
}
.clab-login-link:hover:not(:disabled) { background: color-mix(in srgb, currentColor 12%, transparent); color: var(--clab-ui-editor-foreground, var(--vscode-foreground)); }
.clab-login-button:focus-visible, .clab-login-link:focus-visible { outline: 1px solid var(--login-focus); outline-offset: 2px; }
.clab-login-button:disabled, .clab-login-link:disabled { cursor: not-allowed; opacity: 0.5; }
@media (prefers-reduced-motion: reduce) { .clab-login * { transition: none !important; } }
@media (max-width: 420px) { .clab-login-row { grid-template-columns: 1fr; } .clab-login-card { padding: 24px 20px 0; } .clab-login-footer { margin: 24px -20px 0; padding: 10px 12px 10px 20px; } }
`;

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
  /** Brand mark shown above the form. */
  logoUrl?: string;
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
  const { defaultApiUrl, error, logoUrl, onAddEndpoint, onExportEndpoints, onImportEndpoints } = props;
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

  const sessionDurationInvalid = Boolean(sessionDuration.trim()) && !sessionDurationValid;

  return (
    <div className="clab-login">
      <style>{LOGIN_CSS}</style>
      <section className="clab-login-card" aria-label="Containerlab endpoint login">
        {logoUrl !== undefined ? <img className="clab-login-logo" src={logoUrl} alt="" aria-hidden="true" /> : null}
        <h1 className="clab-login-title">Add Endpoint</h1>
        <p className="clab-login-copy">
          Connect one or more `clab-api-server` endpoints to manage labs in the browser.
        </p>

        {visibleError ? (
          <div role="alert" className="clab-login-message">
            {visibleError}
          </div>
        ) : null}
        {notice ? (
          <div role="status" className="clab-login-message">
            {notice}
          </div>
        ) : null}

        <form className="clab-login-form" onSubmit={handleSubmit}>
          <label className="clab-login-field">
            <span className="clab-login-label">API Endpoint</span>
            <input
              aria-label="API Endpoint"
              className="clab-login-input"
              placeholder="https://localhost:8090"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className="clab-login-field">
            <span className="clab-login-label">Label</span>
            <input
              aria-label="Label"
              className="clab-login-input"
              placeholder="Optional friendly name"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <div className="clab-login-row">
            <label className="clab-login-field">
              <span className="clab-login-label">Username</span>
              <input
                aria-label="Username"
                className="clab-login-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="clab-login-field">
              <span className="clab-login-label">Password</span>
              <input
                aria-label="Password"
                className="clab-login-input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </div>
          <label className="clab-login-field">
            <span className="clab-login-label">Keep me signed in</span>
            <input
              aria-label="Keep me signed in"
              aria-invalid={sessionDurationInvalid}
              className="clab-login-input"
              placeholder="24h"
              value={sessionDuration}
              onChange={(event) => setSessionDuration(event.target.value)}
            />
            <span className="clab-login-helper">
              {sessionDurationValid
                ? "Examples: 24h, 36h, 7d, 1h30m"
                : "Use values like 24h, 36h, 7d, or 1h30m"}
            </span>
          </label>
          <button className="clab-login-button" disabled={submitDisabled} type="submit">
            {busy ? "Adding..." : "Add Endpoint"}
          </button>
        </form>

        <div className="clab-login-footer">
          <span>Endpoint profiles</span>
          <button
            className="clab-login-link"
            data-testid="standalone-endpoints-import"
            disabled={importBusy}
            onClick={() => {
              void handleImportEndpoints();
            }}
            type="button"
          >
            {importBusy ? "Importing..." : "Import"}
          </button>
          <button
            className="clab-login-link"
            data-testid="standalone-endpoints-export"
            onClick={handleExportEndpoints}
            type="button"
          >
            Export
          </button>
        </div>
      </section>
    </div>
  );
}
