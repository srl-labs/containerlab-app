import Button from "@mui/material/Button";
import AddIcon from "@mui/icons-material/Add";
import { useEffect, useRef, useState } from "react";

import {
  rasterizeLogo,
  runEmptyState,
  type EmptyStateView,
  type LogoSample,
} from "./emptyStateField";
import { useWorkspaceHost } from "./WorkspaceHost";

function currentView(host: HTMLElement): EmptyStateView {
  const rect = host.getBoundingClientRect();
  const firefox = /\bFirefox\//.test(navigator.userAgent);
  return {
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
    dpr: Math.min(window.devicePixelRatio || 1, firefox ? 1.25 : 2),
    light: document.documentElement.classList.contains("light"),
    hidden: document.hidden,
  };
}

function loadLogoSample(url: string): Promise<LogoSample | null> {
  const image = new Image();
  image.src = url;
  return image.decode().then(() => rasterizeLogo(image));
}

export function AttractorEmptyState({ onCreateLab }: { onCreateLab?: () => void }) {
  const { assetUrl: publicAssetUrl } = useWorkspaceHost();
  const [animated, setAnimated] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const canvas = document.createElement("canvas");
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.insertBefore(canvas, host.firstChild);

    const logoUrl = publicAssetUrl("containerlab.svg");
    let sample: LogoSample | null = null;
    let stop = () => {};
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    const start = () => {
      stop();
      const enabled = !reducedMotion.matches && sample !== null;
      canvas.style.display = enabled ? "block" : "none";
      setAnimated(enabled);
      if (enabled) stop = runEmptyState(canvas, () => currentView(host), () => sample);
    };
    start();
    reducedMotion.addEventListener("change", start);
    void loadLogoSample(logoUrl).then((next) => {
      if (!disposed) { sample = next; start(); }
    }).catch(() => { /* Keep the static logo when canvas or image decoding is unavailable. */ });

    return () => {
      disposed = true;
      stop();
      reducedMotion.removeEventListener("change", start);
      canvas.remove();
    };
  }, [publicAssetUrl]);

  return (
    <div
      ref={hostRef}
      data-testid="standalone-empty-lab-state"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        overflow: "hidden",
        pointerEvents: "auto",
        backgroundColor: "var(--vscode-editor-background, #000000)",
      }}
    >
      {onCreateLab && <Button variant="text" startIcon={<AddIcon />} onClick={onCreateLab} sx={{ position: "absolute", top: 72, left: "50%", transform: "translateX(-50%)", zIndex: 1, whiteSpace: "nowrap", color: "text.secondary", fontSize: "1.25rem", textTransform: "none", "&:hover": { color: "text.primary" } }}>Create a lab</Button>}
      <img src={publicAssetUrl("containerlab.svg")} alt="Containerlab" style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "min(180px, 35%)", opacity: 0.35, display: animated ? "none" : "block" }} />
    </div>
  );
}
