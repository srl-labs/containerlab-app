import test from "node:test";
import assert from "node:assert/strict";

import {
  deleteCaptureSessionEndpoint,
  getCaptureSessionEndpoint,
  setCaptureSessionEndpoint
} from "./captureSessionStore";

test("capture session store set/get/delete lifecycle", () => {
  const sessionId = "session-a";
  const endpointId = "endpoint-a";

  setCaptureSessionEndpoint(sessionId, endpointId);
  assert.equal(getCaptureSessionEndpoint(sessionId), endpointId);

  deleteCaptureSessionEndpoint(sessionId);
  assert.equal(getCaptureSessionEndpoint(sessionId), undefined);
});
