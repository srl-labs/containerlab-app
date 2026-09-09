export interface WindowVsCodeApiLike {
  postMessage(message: unknown): void;
  getState?(): unknown;
  setState?(state: unknown): void;
  __isDevMock__?: boolean;
  __disableDevMockTraffic__?: boolean;
}

type WindowWithVsCode = Window & {
  vscode?: WindowVsCodeApiLike;
  acquireVsCodeApi?: () => WindowVsCodeApiLike;
};

export function resolveWindowVsCodeApi(targetWindow: Window = window): WindowVsCodeApiLike | undefined {
  const windowWithVsCode = targetWindow as WindowWithVsCode;

  if (windowWithVsCode.vscode) {
    return windowWithVsCode.vscode;
  }

  if (typeof windowWithVsCode.acquireVsCodeApi !== "function") {
    return undefined;
  }

  try {
    const api = windowWithVsCode.acquireVsCodeApi();
    windowWithVsCode.vscode = api;
    return api;
  } catch {
    // VS Code allows acquiring the API only once per webview context.
    // If another bootstrap path already acquired and cached it, reuse that instance.
    return windowWithVsCode.vscode;
  }
}
