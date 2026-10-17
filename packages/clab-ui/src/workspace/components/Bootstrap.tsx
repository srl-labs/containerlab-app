import React, { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  APP_DOCS_URL,
  ENDPOINT_EXPORT_FILENAME,
  DEFAULT_ENDPOINT_SESSION_DURATION,
  isValidEndpointSessionDuration,
  splitSetupCommand
} from "../endpoints";
import type { EndpointImportResult, EndpointSessionDuration, LocalEndpointOffer } from "../types";
import { controlRadius, dialogRadius, overlayShadow } from "../../theme/surfaces";
import { MONO_FONT_FAMILY, UI_FONT_FAMILY } from "../../theme/typography";

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
.clab-login-local { border: 1px solid var(--login-border); border-radius: ${controlRadius}; display: grid; gap: 10px; margin: 0 0 22px; padding: 14px; }
.clab-login-local-head { align-items: center; display: flex; gap: 10px; }
.clab-login-local-title { font-weight: 600; }
.clab-login-local-state { color: var(--login-muted); font-size: 12px; margin-left: auto; }
.clab-login-local-state[data-ready="false"] { color: var(--vscode-editorWarning-foreground, #cca700); }
.clab-login-local-copy { color: var(--login-muted); margin: 0; }
.clab-login-local-problems { margin: 0; padding-left: 18px; }
.clab-login-local-problems li + li { margin-top: 4px; }
.clab-login-code {
  background: color-mix(in srgb, currentColor 9%, transparent); border-radius: 3px; font-family: ${MONO_FONT_FAMILY};
  font-size: 11.5px; overflow-wrap: anywhere; padding: 1px 4px;
}
.clab-login-local-actions { align-items: center; display: flex; gap: 8px; }
.clab-login-local-actions .clab-login-button { margin: 0; width: auto; }
.clab-login-secondary {
  background: transparent; border: 1px solid var(--vscode-input-border, var(--login-border)); border-radius: ${controlRadius};
  color: inherit; cursor: pointer; font: inherit; height: 30px; padding: 0 12px; transition: background-color 120ms ease;
}
.clab-login-secondary:hover:not(:disabled) { background: color-mix(in srgb, currentColor 10%, transparent); }
.clab-login-secondary:disabled { cursor: not-allowed; opacity: 0.5; }
.clab-login-help { color: var(--login-muted); font-size: 12px; text-align: center; }
.clab-login-help a { color: var(--vscode-textLink-foreground, #3794ff); }
.clab-login-divider { align-items: center; color: var(--login-muted); display: flex; font-size: 11px; gap: 10px; margin: 0 0 18px; text-transform: uppercase; }
.clab-login-divider::before, .clab-login-divider::after { border-top: 1px solid var(--login-border); content: ""; flex: 1; }
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
.clab-login-button:focus-visible, .clab-login-link:focus-visible, .clab-login-secondary:focus-visible { outline: 1px solid var(--login-focus); outline-offset: 2px; }
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
    return "No lab host profiles were found in the import file.";
  }
  return `Imported ${result.total} lab host ${result.total === 1 ? "profile" : "profiles"}.`;
}

function SetupProblem({ problem }: { problem: string }) {
  const { before, command, after } = splitSetupCommand(problem);
  return (
    <>
      {before}
      {command !== undefined ? <code className="clab-login-code">{command}</code> : null}
      {after}
    </>
  );
}

/** Labs on this computer: ready to use, or what to fix first. */
function LocalSetupCard(props: {
  busy: boolean;
  offer: LocalEndpointOffer;
  onUse: () => void;
  onCheckAgain: () => void;
}) {
  const { busy, offer, onCheckAgain, onUse } = props;
  return (
    <section className="clab-login-local" aria-label="This computer" data-testid="standalone-local-endpoint">
      <div className="clab-login-local-head">
        <span className="clab-login-local-title">This computer</span>
        <span className="clab-login-local-state" data-ready={offer.available}>
          {offer.available
            ? `containerlab ${offer.containerlabVersion ?? ""}`.trim()
            : "Not ready"}
        </span>
      </div>
      {offer.available ? (
        <p className="clab-login-local-copy">Run labs with containerlab on this computer. No sign-in needed.</p>
      ) : (
        <>
          <p className="clab-login-local-copy">Containerlab cannot run labs here yet:</p>
          <ul className="clab-login-local-problems" role="note">
            {offer.problems.map((problem) => (
              <li key={problem}>
                <SetupProblem problem={problem} />
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="clab-login-local-actions">
        {offer.available ? (
          <button
            className="clab-login-button"
            data-testid="standalone-local-endpoint-add"
            disabled={busy}
            onClick={onUse}
            type="button"
          >
            Use This Computer
          </button>
        ) : (
          <>
            {offer.onCheckAgain ? (
              <button
                className="clab-login-secondary"
                data-testid="standalone-local-endpoint-check"
                disabled={busy}
                onClick={onCheckAgain}
                type="button"
              >
                {busy ? "Checking..." : "Check Again"}
              </button>
            ) : null}
            <a
              className="clab-login-link"
              href={`${APP_DOCS_URL}install/desktop/#run-labs-on-this-computer`}
              rel="noreferrer"
              target="_blank"
            >
              Setup guide
            </a>
          </>
        )}
      </div>
    </section>
  );
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
  /** Offered when the host can run labs on this machine. */
  localEndpoint?: LocalEndpointOffer;
}) {
  const { defaultApiUrl, error, logoUrl, localEndpoint, onAddEndpoint, onExportEndpoints, onImportEndpoints } =
    props;
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

  const runLocalAction = useCallback(async (action: (() => Promise<void>) | undefined) => {
    if (!action || busy) {
      return;
    }
    setBusy(true);
    setLocalError(null);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
  }, [submit]);

  const sessionDurationInvalid = Boolean(sessionDuration.trim()) && !sessionDurationValid;

  return (
    <div className="clab-login">
      <style>{LOGIN_CSS}</style>
      <section className="clab-login-card" aria-label="Containerlab sign-in">
        {logoUrl !== undefined ? <img className="clab-login-logo" src={logoUrl} alt="" aria-hidden="true" /> : null}
        <h1 className="clab-login-title">{localEndpoint ? "Welcome to Containerlab" : "Sign in to a lab host"}</h1>
        <p className="clab-login-copy">
          {localEndpoint
            ? "Run labs on this computer, or sign in to clab-api-server on another machine."
            : "Sign in to clab-api-server on the Linux machine that runs your labs."}
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

        {localEndpoint ? (
          <LocalSetupCard
            busy={busy}
            offer={localEndpoint}
            onCheckAgain={() => {
              void runLocalAction(localEndpoint.onCheckAgain);
            }}
            onUse={() => {
              void runLocalAction(localEndpoint.onAdd);
            }}
          />
        ) : null}
        {localEndpoint ? <div className="clab-login-divider">or sign in to a lab host</div> : null}

        <form className="clab-login-form" onSubmit={handleSubmit}>
          <label className="clab-login-field">
            <span className="clab-login-label">Lab host URL</span>
            <input
              aria-label="Lab host URL"
              className="clab-login-input"
              placeholder="https://localhost:8090"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className="clab-login-field">
            <span className="clab-login-label">Name</span>
            <input
              aria-label="Name"
              className="clab-login-input"
              placeholder="Optional, defaults to the host name"
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
            <span className="clab-login-label">Stay signed in for</span>
            <input
              aria-label="Stay signed in for"
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
            {busy ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="clab-login-footer">
          <span>Lab host profiles</span>
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
