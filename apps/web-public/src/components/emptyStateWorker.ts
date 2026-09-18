import {
  runEmptyState,
  type EmptyStateView,
  type LogoSample,
} from "./emptyStateField";

type InitMessage = {
  type: "init";
  canvas: OffscreenCanvas;
  view: EmptyStateView;
};

type ViewMessage = {
  type: "view";
  view: EmptyStateView;
};

type LogoMessage = {
  type: "logo";
  sample: LogoSample;
};

let view: EmptyStateView = {
  width: 1,
  height: 1,
  dpr: 1,
  light: false,
  hidden: false,
};
let sample: LogoSample | null = null;
let stop: (() => void) | undefined;

self.onmessage = (event: MessageEvent<InitMessage | ViewMessage | LogoMessage>) => {
  const message = event.data;
  if (message.type === "view") {
    view = message.view;
    return;
  }
  if (message.type === "logo") {
    sample = message.sample;
    return;
  }
  if (message.type !== "init") return;
  stop?.();
  view = message.view;
  stop = runEmptyState(
    message.canvas,
    () => view,
    () => sample,
  );
};
