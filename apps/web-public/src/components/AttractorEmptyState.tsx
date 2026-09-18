import { useEffect, useRef } from "react";

import {
  rasterizeLogo,
  runEmptyState,
  type EmptyStateView,
  type LogoSample,
} from "./emptyStateField";
import { publicAssetUrl } from "../publicAssetUrl";

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
    host.appendChild(canvas);

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
    />
  );
}
