import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { WORKSPACE_ASSETS } from "@containerlab/clab-ui/workspace/types";

import { STARTUP_LOGO, standalonePublicDir } from "./viteStartupShell";

test("standalone hosts serve every asset the shared workspace requests", () => {
  const missing = WORKSPACE_ASSETS.filter((asset) => !existsSync(path.join(standalonePublicDir, asset)));
  assert.deepEqual(missing, []);
});

test("the page startup screen uses the workspace loading logo", () => {
  assert.ok((WORKSPACE_ASSETS as readonly string[]).includes(STARTUP_LOGO));
});
