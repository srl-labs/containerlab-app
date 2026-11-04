// Read-only preview of a topology template as containerlab renders it.
import * as monaco from "monaco-editor";
import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { isValidVarsFile } from "../../host/lifecycleOptions";
import { headerBarHeight } from "../../theme/surfaces";
import type { RenderedTopologyPreview } from "../types";

interface TopologyTemplatePreviewProps {
  endpointId: string;
  path: string;
  /** Changes whenever the saved template changes, so the preview renders it again. */
  savedContent: string;
  render: (request: { endpointId: string; path: string; varsFile?: string }) => Promise<RenderedTopologyPreview>;
}

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; result: RenderedTopologyPreview }
  | { status: "failed"; message: string };

function describeSource(result: RenderedTopologyPreview): string {
  const parts: string[] = [];
  if (result.labName !== undefined && result.labName !== "") parts.push(`Lab ${result.labName}`);
  const varsFiles = result.varsFiles ?? [];
  parts.push(varsFiles.length > 0 ? `Variables from ${varsFiles.join(", ")}` : "No variables file");
  return parts.join(" · ");
}

function describeState(state: PreviewState): string {
  if (state.status === "ready") return describeSource(state.result);
  return state.status === "loading" ? "Rendering…" : " ";
}

export function TopologyTemplatePreview({ endpointId, path, savedContent, render }: TopologyTemplatePreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const requestRef = useRef(0);
  const [varsFile, setVarsFile] = useState("");
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const varsFileInvalid = varsFile.trim() !== "" && !isValidVarsFile(varsFile.trim());

  const varsFileRef = useRef(varsFile);
  useEffect(() => {
    varsFileRef.current = varsFile;
  }, [varsFile]);

  const runRender = useCallback(() => {
    const request = ++requestRef.current;
    setState({ status: "loading" });
    const trimmed = varsFileRef.current.trim();
    render({ endpointId, path, ...(trimmed ? { varsFile: trimmed } : {}) }).then(
      (result) => {
        if (request === requestRef.current) setState({ status: "ready", result });
      },
      (error: unknown) => {
        if (request !== requestRef.current) return;
        setState({ status: "failed", message: error instanceof Error ? error.message : String(error) });
      }
    );
  }, [endpointId, path, render]);

  // Render on open and again after each save; the vars file applies on Render.
  useEffect(() => {
    runRender();
  }, [runRender, savedContent]);

  const content = state.status === "ready" ? state.result.content : "";
  useEffect(() => {
    if (!containerRef.current) return undefined;
    const editor = monaco.editor.create(containerRef.current, {
      value: "",
      language: "yaml",
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      tabSize: 2,
      wordWrap: "on"
    });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== content) editor.setValue(content);
  }, [content]);

  const runRefresh = () => {
    if (!varsFileInvalid) runRender();
  };

  return (
    <Box
      data-testid="topology-template-preview"
      sx={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0, flex: 1 }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          height: headerBarHeight,
          flexShrink: 0,
          px: 1.5,
          borderBottom: 1,
          borderColor: "divider"
        }}
      >
        <Typography variant="subtitle2" noWrap sx={{ flexShrink: 0 }}>
          Rendered topology
        </Typography>
        <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0, color: "text.secondary" }}>
          Read only
        </Typography>
        <TextField
          size="small"
          placeholder="Variables file"
          value={varsFile}
          error={varsFileInvalid}
          onChange={(event) => setVarsFile(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") runRefresh();
          }}
          slotProps={{
            htmlInput: {
              "aria-label": "Variables file, relative to the template",
              "data-testid": "topology-template-preview-vars"
            }
          }}
          sx={{ width: 200 }}
        />
        <Button
          size="small"
          variant="text"
          disabled={varsFileInvalid || state.status === "loading"}
          onClick={runRefresh}
          data-testid="topology-template-preview-refresh"
        >
          Render
        </Button>
      </Box>
      {state.status === "failed" ? (
        <Alert
          severity="error"
          data-testid="topology-template-preview-error"
          sx={{ flexShrink: 0, borderRadius: 0, borderWidth: 0, borderBottomWidth: 1, whiteSpace: "pre-wrap" }}
        >
          {state.message}
        </Alert>
      ) : null}
      {state.status === "ready" && state.result.error !== undefined && state.result.error !== "" ? (
        <Alert
          severity="warning"
          data-testid="topology-template-preview-warning"
          sx={{ flexShrink: 0, borderRadius: 0, borderWidth: 0, borderBottomWidth: 1, whiteSpace: "pre-wrap" }}
        >
          {state.result.error}
        </Alert>
      ) : null}
      <Typography
        variant="caption"
        data-testid="topology-template-preview-source"
        sx={{ px: 1.5, py: 0.5, color: "text.secondary", flexShrink: 0 }}
      >
        {describeState(state)}
      </Typography>
      <div
        ref={containerRef}
        data-testid="topology-template-preview-yaml"
        data-rendered={state.status === "ready" ? "true" : "false"}
        style={{ flex: 1, minHeight: 0 }}
      />
    </Box>
  );
}
