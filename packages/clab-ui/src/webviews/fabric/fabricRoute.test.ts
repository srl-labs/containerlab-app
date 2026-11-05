import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_ROUTE, nodeRoute, parseRoute, reportRoute, routeFilters } from "./fabricRoute";

test("a kept route comes back as it was", () => {
  const route = reportRoute("bgp-peers", { "f.state": "!up" });
  assert.deepEqual(parseRoute(JSON.stringify(route)), route);
  assert.deepEqual(parseRoute(JSON.stringify(nodeRoute("leaf1"))), { view: "topology", query: { node: "leaf1" } });
});

test("anything else falls back to the topology", () => {
  for (const text of [null, "", "{", '"x"', '{"view":"nope","query":{}}', '{"view":"report","query":{}}', '{"view":"nodes"}']) {
    assert.deepEqual(parseRoute(text), DEFAULT_ROUTE, String(text));
  }
});

test("a route's filters are the f. parameters", () => {
  assert.deepEqual(routeFilters({ node: "leaf1", "f.NI": "=default", "f.peer": "10" }), { NI: "=default", peer: "10" });
});
