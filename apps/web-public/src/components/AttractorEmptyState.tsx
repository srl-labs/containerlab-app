import { useEffect, useRef } from "react";

import {
  rasterizeLogo,
  runEmptyState,
  type EmptyStateView,
  type LogoSample,
} from "./emptyStateField";
import { publicAssetUrl } from "../publicAssetUrl";
import { SANDBOX_CREATE_TOPOLOGY_EVENT } from "./SandboxSidebar";

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

export function AttractorEmptyState() {
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
    let worker: Worker | undefined;
    const view = currentView(host);

    if (typeof canvas.transferControlToOffscreen === "function") {
      worker = new Worker(new URL("./emptyStateWorker.ts", import.meta.url), {
        type: "module",
      });
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({ type: "init", canvas: offscreen, view }, [offscreen]);
      const postView = () =>
        worker?.postMessage({ type: "view", view: currentView(host) });
      const observer = new ResizeObserver(postView);
      observer.observe(host);
      document.addEventListener("visibilitychange", postView);
      const theme = new MutationObserver(postView);
      theme.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      stop = () => {
        observer.disconnect();
        theme.disconnect();
        document.removeEventListener("visibilitychange", postView);
        worker?.terminate();
      };
    } else {
      stop = runEmptyState(
        canvas,
        () => currentView(host),
        () => sample,
      );
    }

    void loadLogoSample(logoUrl).then((next) => {
      if (!next) return;
      sample = next;
      if (worker) {
        worker.postMessage({ type: "logo", sample: next }, [next.data.buffer]);
      }
    });

    return () => {
      stop();
      canvas.remove();
    };
  }, []);

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
      <style>{`
        [data-testid="standalone-empty-lab-state"] .empty-state-link {
          color: inherit;
          background: none;
          border: 0;
          padding: 0;
          font: inherit;
          cursor: pointer;
          text-decoration: none;
          opacity: 0.72;
          transition: opacity 160ms ease;
        }
        [data-testid="standalone-empty-lab-state"] .empty-state-link:hover,
        [data-testid="standalone-empty-lab-state"] .empty-state-link:focus-visible {
          opacity: 1;
        }
      `}</style>
      <div
        style={{
          position: "absolute",
          top: 72,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1,
          width: "max-content",
          padding: "5%",
          marginTop: "-5%",
          pointerEvents: "none",
          color: "var(--vscode-editor-foreground, #ececec)",
          fontSize: 24,
          fontWeight: 300,
          letterSpacing: "0.02em",
          background:
            "radial-gradient(closest-side, var(--vscode-editor-background, #000), transparent)",
        }}
      >
        <button
          type="button"
          className="empty-state-link"
          style={{ pointerEvents: "auto" }}
          onClick={() => {
            window.dispatchEvent(new Event(SANDBOX_CREATE_TOPOLOGY_EVENT));
          }}
        >
          Create a lab
        </button>
      </div>
    </div>
  );
}
