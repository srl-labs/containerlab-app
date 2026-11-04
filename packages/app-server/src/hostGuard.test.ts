import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { isAllowedHost, parseAllowedHosts, registerHostGuard } from "./hostGuard";

test("allowed hosts match exactly, and names without a port match any port", () => {
  const allowed = ["127.0.0.1:4000", "labs.example.com"];
  assert.equal(isAllowedHost("127.0.0.1:4000", allowed), true);
  assert.equal(isAllowedHost("LABS.example.com:8443", allowed), true);
  assert.equal(isAllowedHost("labs.example.com", allowed), true);
  assert.equal(isAllowedHost("127.0.0.1:4001", allowed), false);
  assert.equal(isAllowedHost("attacker.example:4000", allowed), false);
  assert.equal(isAllowedHost("labs.example.com.attacker.example", allowed), false);
  assert.equal(isAllowedHost(undefined, allowed), false);
});

test("WEB_ALLOWED_HOSTS is a comma separated list, and unset without entries", () => {
  assert.deepEqual(parseAllowedHosts(" Labs.example.com , 10.0.0.1:3001,"), ["labs.example.com", "10.0.0.1:3001"]);
  assert.equal(parseAllowedHosts(undefined), undefined);
  assert.equal(parseAllowedHosts(" , "), undefined);
});

test("a request for another host name is refused before it reaches a route", async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  let reached = 0;
  registerHostGuard(app, () => ["127.0.0.1:4000"]);
  app.post("/api/runtime/lab-operations/host-script/stream", async () => {
    reached += 1;
    return {};
  });

  const refused = await app.inject({
    method: "POST",
    url: "/api/runtime/lab-operations/host-script/stream",
    headers: { host: "attacker.example:4000" },
    payload: {}
  });
  assert.equal(refused.statusCode, 403);
  assert.equal(reached, 0);

  const allowed = await app.inject({
    method: "POST",
    url: "/api/runtime/lab-operations/host-script/stream",
    headers: { host: "127.0.0.1:4000" },
    payload: {}
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(reached, 1);
});
