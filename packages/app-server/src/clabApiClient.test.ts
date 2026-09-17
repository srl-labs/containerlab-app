import assert from "node:assert/strict";
import test from "node:test";
import undici, { Response } from "undici";

import { ClabApiClient, getHttpErrorStatus } from "./clabApiClient";

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
      new Error(
        "Unable to connect to clab-api-server at https://127.0.0.1:18090: fetch failed: other side closed"
      )
    ),
    502
  );
});

for (const status of [401, 403, 500]) {
  test(`file existence checks propagate ${status} instead of treating the file as missing`, async (t) => {
    t.mock.method(undici, "fetch", () => Promise.resolve(new Response(null, { status })));
    const client = new ClabApiClient({ baseUrl: "https://api.test" });
    await assert.rejects(client.headFile("token", "demo", "demo.clab.yml"), { status });
  });
}

test("file existence checks distinguish missing files from existing ones", async (t) => {
  const client = new ClabApiClient({ baseUrl: "https://api.test" });
  const mock = t.mock.method(undici, "fetch", () =>
    Promise.resolve(new Response(null, { status: 404 }))
  );
  assert.equal(await client.headFile("token", "demo", "demo.clab.yml"), false);
  mock.mock.mockImplementation(() => Promise.resolve(new Response(null, { status: 200 })));
  assert.equal(await client.headFile("token", "demo", "demo.clab.yml"), true);
});
