import assert from "node:assert/strict";
import test from "node:test";

import { resolveWindowVsCodeApi, type WindowVsCodeApiLike } from "./vscodeApi";

class FakeWindow {
  public vscode: WindowVsCodeApiLike | undefined;
  public acquireVsCodeApi: (() => WindowVsCodeApiLike) | undefined;
}

test("resolveWindowVsCodeApi reuses a preloaded VS Code API instance", () => {
  let acquireCalls = 0;
  const api: WindowVsCodeApiLike = {
    postMessage: () => {}
  };
  const targetWindow = new FakeWindow();
  targetWindow.vscode = api;
  targetWindow.acquireVsCodeApi = () => {
    acquireCalls += 1;
    return api;
  };

  const resolved = resolveWindowVsCodeApi(targetWindow as unknown as Window);

  assert.equal(resolved, api);
  assert.equal(acquireCalls, 0);
});

test("resolveWindowVsCodeApi caches the acquired VS Code API instance", () => {
  let acquireCalls = 0;
  const api: WindowVsCodeApiLike = {
    postMessage: () => {}
  };
  const targetWindow = new FakeWindow();
  targetWindow.acquireVsCodeApi = () => {
    acquireCalls += 1;
    return api;
  };

  const first = resolveWindowVsCodeApi(targetWindow as unknown as Window);
  const second = resolveWindowVsCodeApi(targetWindow as unknown as Window);

  assert.equal(first, api);
  assert.equal(second, api);
  assert.equal(acquireCalls, 1);
});
