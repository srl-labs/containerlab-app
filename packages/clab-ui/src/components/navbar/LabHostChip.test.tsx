import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { labHostIdentityKindLabel, labHostStatusWord, parseLabHostIdentity } from "../../host/labHostIdentity";

import { LabHostChip } from "./LabHostChip";

test("the chip names the lab host and its kind, with its status", () => {
  const html = renderToStaticMarkup(
    <LabHostChip host={{ id: "c9s-1", label: "kind-c9s-app", kind: "cluster", runtime: "c9s", status: "connected" }} />
  );
  assert.match(html, /kind-c9s-app/);
  assert.match(html, /· Kubernetes/);
  assert.match(html, /data-status="connected"/);
  assert.match(html, /aria-label="Lab host kind-c9s-app, Kubernetes"/);
  assert.doesNotMatch(html, /<button/, "without onOpen it is no button");
});

test("the chip opens the lab host's settings when the app can", () => {
  const html = renderToStaticMarkup(
    <LabHostChip
      host={{ id: "api-1", label: "lab-server:18190", kind: "server", runtime: "c9s", status: "session_expired" }}
      onOpen={() => undefined}
    />
  );
  assert.match(html, /<button/);
  assert.match(html, /aria-label="Lab host lab-server:18190, API Server · c9s, Session expired"/);
  assert.match(html, /data-status="session_expired"/);
});

test("kind labels: This computer shows its runtime, an API Server its runtime next to its kind", () => {
  assert.equal(labHostIdentityKindLabel({ kind: "this-computer", label: "This computer", runtime: "podman" }), "Podman");
  assert.equal(labHostIdentityKindLabel({ kind: "this-computer", label: "This computer" }), "Docker");
  assert.equal(labHostIdentityKindLabel({ kind: "cluster", label: "kind-c9s-app", runtime: "c9s" }, true), "Kubernetes");
  assert.equal(labHostIdentityKindLabel({ kind: "server", label: "lab", runtime: "docker" }), "API Server");
  assert.equal(labHostIdentityKindLabel({ kind: "server", label: "lab", runtime: "docker" }, true), "API Server · Docker");
});

test("status words follow the explorer roots", () => {
  assert.equal(labHostStatusWord({ kind: "cluster", status: "connected" }), undefined);
  assert.equal(labHostStatusWord({ kind: "cluster", status: "offline" }), "Not ready");
  assert.equal(labHostStatusWord({ kind: "server", status: "offline" }), "Unreachable");
  assert.equal(labHostStatusWord({ kind: "server", status: "saved" }), "Signed out");
});

test("a lab host identity from a host transport keeps only what is valid", () => {
  assert.deepEqual(
    parseLabHostIdentity({ id: "a", label: "A", kind: "server", runtime: "lxc", status: "bogus", details: ["x", 3, ""] }),
    { id: "a", label: "A", kind: "server", details: ["x"] }
  );
  assert.equal(parseLabHostIdentity({ id: "a", label: "A", kind: "moon" }), undefined);
  assert.equal(parseLabHostIdentity(undefined), undefined);
});
