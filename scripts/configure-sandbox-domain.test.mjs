import assert from "node:assert/strict";
import test from "node:test";
import { configureSandboxDomain } from "./configure-sandbox-domain.mjs";

const branch = `${"a".repeat(40)}-pr`;
const hostname = `${branch}.containerlab.app`;
const target = `${branch}.sandbox-123.pages.dev`;
const env = {
  CLOUDFLARE_API_TOKEN: "test-token",
  CLOUDFLARE_ACCOUNT_ID: "account",
  CLOUDFLARE_ZONE_ID: "zone",
  PROJECT_NAME: "sandbox",
  SANDBOX_BRANCH: branch,
};

function fixture({ records = [], domains = [], autoDns = false, fail = false } = {}) {
  const writes = [];
  const request = async (url, options) => {
    const path = new URL(url).pathname;
    assert.equal(options.headers.Authorization, "Bearer test-token");
    if (fail) return Response.json({ success: false, errors: [{ code: 10000 }] }, { status: 403 });
    let result;
    if (options.method !== "GET") {
      const body = JSON.parse(options.body);
      writes.push({ path, method: options.method, body });
      if (path.endsWith("/domains")) {
        domains.push(body);
        if (autoDns) records.push({ id: "record", type: "CNAME", content: "sandbox-123.pages.dev", proxied: true });
      } else if (options.method === "POST") {
        records.push({ id: "record", ...body });
      } else {
        records[0] = { id: "record", ...body };
      }
      result = body;
    } else if (path.endsWith("/domains")) {
      result = domains;
    } else if (path.endsWith("/dns_records")) {
      assert.equal(new URL(url).searchParams.get("name"), hostname);
      result = records;
    } else {
      result = { subdomain: "sandbox-123.pages.dev", production_branch: "main" };
    }
    return Response.json({ success: true, result });
  };
  return { request, writes };
}

test("registers the custom domain and points a proxied CNAME at the actual Pages alias", async () => {
  const api = fixture();
  assert.equal(await configureSandboxDomain(env, api.request), `https://${hostname}`);
  assert.equal(api.writes.length, 2);
  assert.deepEqual(api.writes[0].body, { name: hostname });
  assert.deepEqual(api.writes[1].body, { type: "CNAME", name: hostname, content: target, proxied: true, ttl: 1 });
  await configureSandboxDomain(env, api.request);
  assert.equal(api.writes.length, 2);
});

test("updates a DNS record automatically created during Pages registration to the preview alias", async () => {
  const api = fixture({ autoDns: true });
  await configureSandboxDomain(env, api.request);
  assert.equal(api.writes[1].method, "PATCH");
  assert.equal(api.writes[1].body.content, target);
});

test("refuses conflicting DNS records before making any changes", async () => {
  for (const record of [
    { type: "A", content: "192.0.2.1" },
    { type: "CNAME", content: "another-project.pages.dev" },
  ]) {
    const api = fixture({ records: [record] });
    await assert.rejects(configureSandboxDomain(env, api.request), /conflicting DNS/);
    assert.equal(api.writes.length, 0);
  }
});

test("fails on API errors instead of reporting a configured URL", async () => {
  const api = fixture({ fail: true });
  await assert.rejects(configureSandboxDomain(env, api.request), /HTTP 403/);
});

test("rejects missing configuration and non-commit preview names before API access", async () => {
  const request = () => assert.fail("API must not be called");
  await assert.rejects(configureSandboxDomain({ ...env, CLOUDFLARE_ZONE_ID: "" }, request), /Missing CLOUDFLARE_ZONE_ID/);
  await assert.rejects(configureSandboxDomain({ ...env, SANDBOX_BRANCH: "main" }, request), /full commit SHA/);
});
