import assert from "node:assert/strict";
import test from "node:test";

import { encodeVncProxyWildcard, vncUpstreamQuery } from "./vncProxyPath";

test("VNC proxy wildcard canonicalizes ordinary asset paths", () => {
  assert.equal(encodeVncProxyWildcard("app/ui.js"), "app/ui.js");
  assert.equal(
    encodeVncProxyWildcard("assets/a file.css"),
    "assets/a%20file.css",
  );
});

test("VNC proxy wildcard rejects decoded and multiply encoded traversal", () => {
  for (const value of [
    "../../users",
    "..\\..\\users",
    "%2e%2e/%2e%2e/users",
    "%252e%252e%252fusers",
    "assets/%250aheader",
  ]) {
    assert.equal(encodeVncProxyWildcard(value), null, value);
  }
});

test("VNC upstream query strips endpoint selection and canonicalizes values", () => {
  assert.equal(
    vncUpstreamQuery("/vnc/index.html?endpointId=secret&view=fit&name=a%20b"),
    "?view=fit&name=a+b",
  );
  assert.equal(
    vncUpstreamQuery("/vnc/?%65ndpointId=secret&endpointId=second"),
    "",
  );
});
