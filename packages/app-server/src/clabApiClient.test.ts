import assert from "node:assert/strict";
import test from "node:test";

import { getHttpErrorStatus } from "./clabApiClient";

test("getHttpErrorStatus preserves explicit upstream HTTP status", () => {
  const error = new Error("upstream returned forbidden") as Error & { status?: number };
  error.status = 403;

  assert.equal(getHttpErrorStatus(error), 403);
});

test("getHttpErrorStatus maps fetch socket failures to bad gateway", () => {
  assert.equal(getHttpErrorStatus(new TypeError("fetch failed")), 502);
});

test("getHttpErrorStatus maps wrapped clab-api-server network failures to bad gateway", () => {
  assert.equal(
    getHttpErrorStatus(
      new Error("Unable to connect to clab-api-server at https://127.0.0.1:18090: fetch failed: other side closed")
    ),
    502
  );
});
