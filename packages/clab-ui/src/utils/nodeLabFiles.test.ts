import assert from "node:assert/strict";
import test from "node:test";

import { collectNodeLabFiles } from "./nodeLabFiles";

test("a node's startup config, license and file binds open, once each", () => {
  const files = collectNodeLabFiles(
    {
      "startup-config": "configs/__clabNodeName__.cfg",
      license: "license.key",
      binds: [
        "certs/r1.pem:/etc/r1.pem",
        "/lib/modules:/lib/modules",
        "license.key:/opt/license"
      ]
    },
    { labName: "dc", nodeName: "r1" }
  );
  assert.deepEqual(files, [
    { role: "startup-config", request: { path: "configs/r1.cfg", create: true } },
    { role: "license", request: { path: "license.key", create: true } },
    { role: "bind", request: { path: "certs/r1.pem", create: true } }
  ]);
});
