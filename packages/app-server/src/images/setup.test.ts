import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalUiStore } from "../localUiStore.ts";
import { enableImages, type ImagesCapableEndpoint } from "./setup.ts";
import { FAKE_CLIMG } from "./testHarness.ts";

test("the palette store is the workspace store even when climg fails its startup check", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "images-setup-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "ws");
  const original = createLocalUiStore({ workspaceRoot: workspace, clabDirectory: workspace });
  const endpoint: ImagesCapableEndpoint = {
    url: "local:x",
    backend: { options: { workspaceRoot: workspace } },
    ui: original
  };
  const messages = await enableImages(
    endpoint,
    { WEB_LOCAL_CLIMG_PATH: FAKE_CLIMG, WEB_LOCAL_CLIMG_STATE: path.join(root, "state") },
    { extraEnv: { FAKE_CLIMG_VERSION: "climg 2.0.0 (contract 2)" } }
  );
  assert.ok(messages.some((message) => message.startsWith("Images are off")), messages.join("\n"));
  assert.ok(endpoint.images && "problem" in endpoint.images);
  assert.notEqual(endpoint.ui, original, "endpoint.ui must be the workspace store, not the previous one");
});
