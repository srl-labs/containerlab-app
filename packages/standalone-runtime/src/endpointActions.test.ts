import assert from "node:assert/strict";
import test from "node:test";

import { dispatchEndpointUiAction, subscribeEndpointUiAction } from "./endpointActions";

test("endpoint UI action events include add endpoint requests", (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: new EventTarget(),
  });
  t.after(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
      return;
    }
    delete (globalThis as { window?: unknown }).window;
  });

  const receivedActions: unknown[] = [];
  const unsubscribe = subscribeEndpointUiAction((action) => {
    receivedActions.push(action);
  });

  try {
    dispatchEndpointUiAction({ action: "add" });

    assert.deepEqual(receivedActions, [{ action: "add" }]);
  } finally {
    unsubscribe();
  }
});
