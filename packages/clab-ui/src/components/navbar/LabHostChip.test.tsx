import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  labHostCompactName,
  labHostKindLabel,
  labHostShortLabel,
  labHostStatusWord,
  labHostTag,
  labHostTagLabel,
  parseLabHostIdentity
} from "../../host/labHostIdentity";

import { LabHostChip } from "./LabHostChip";

test("the chip names the lab host and shows its runtime as an icon, with its status", () => {
  const html = renderToStaticMarkup(
    <LabHostChip host={{ id: "c9s-1", label: "kind-c9s-app", kind: "cluster", runtime: "c9s", status: "connected" }} />
  );
  assert.match(html, /kind-c9s-app/);
  assert.match(html, /data-testid="lab-host-chip-runtime" data-runtime="c9s"/);
  assert.match(html, /data-status="connected"/);
  assert.match(html, /aria-label="Lab host kind-c9s-app, Kubernetes · c9s"/);
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
  assert.doesNotMatch(html, /· API Server/, "the kind stays in the tooltip");
});

test("this machine is Local in the chip, with its runtime", () => {
  const html = renderToStaticMarkup(
    <LabHostChip host={{ id: "local", label: "This computer", kind: "this-computer", runtime: "docker" }} />
  );
  assert.match(html, />Local</);
  assert.doesNotMatch(html, /This computer/);
  assert.match(html, /aria-label="Lab host Local, Docker"/);
  assert.match(html, /data-testid="lab-host-chip-runtime" data-runtime="docker"/);
  assert.equal(labHostCompactName({ kind: "this-computer", label: "Workstation" }), "Workstation");
  assert.equal(labHostCompactName({ kind: "server", label: "This computer" }), "This computer");
});

test("Podman has its icon, and an API Server without a runtime yet shows no runtime", () => {
  const podman = renderToStaticMarkup(
    <LabHostChip host={{ id: "local", label: "This computer", kind: "this-computer", runtime: "podman" }} />
  );
  assert.match(podman, /<svg[^>]*data-runtime="podman"/);
  assert.match(podman, /aria-label="Lab host Local, Podman"/);
  assert.doesNotMatch(podman, />Podman</);
  const signedOut = renderToStaticMarkup(<LabHostChip host={{ id: "api", label: "lab", kind: "server", status: "saved" }} />);
  assert.doesNotMatch(signedOut, /data-runtime/);
});

test("one label names a lab host's kind and runtime everywhere", () => {
  assert.equal(labHostKindLabel({ kind: "server", runtime: "c9s" }), "API Server · c9s");
  assert.equal(labHostKindLabel({ kind: "server", runtime: "docker" }), "API Server · Docker");
  assert.equal(labHostKindLabel({ kind: "server" }), "API Server", "until the API Server told its runtime");
  assert.equal(labHostKindLabel({ kind: "this-computer", runtime: "podman" }), "This computer · Podman");
  assert.equal(labHostKindLabel({ kind: "this-computer" }), "This computer · Docker");
  assert.equal(labHostKindLabel({ kind: "cluster" }), "Kubernetes · c9s");
  // Next to its name, This computer's tag leaves out what its name says.
  assert.equal(labHostTagLabel({ kind: "this-computer", label: "This computer", runtime: "podman" }), "Podman");
  assert.equal(labHostTagLabel({ kind: "this-computer", label: "Workstation" }), "This computer · Docker");
  assert.equal(labHostTagLabel({ kind: "server", label: "lab", runtime: "c9s" }), "API Server · c9s");
  assert.equal(labHostShortLabel({ kind: "server", runtime: "podman" }), "API · Podman");
  assert.equal(labHostShortLabel({ kind: "server" }), "API Server");
  assert.equal(labHostShortLabel({ kind: "this-computer", runtime: "podman" }), "Podman");
  assert.deepEqual(labHostTag({ kind: "cluster", label: "kind-c9s-app" }), {
    label: "Kubernetes · c9s",
    short: "K8s · c9s",
    title: "Kubernetes · c9s"
  });
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
