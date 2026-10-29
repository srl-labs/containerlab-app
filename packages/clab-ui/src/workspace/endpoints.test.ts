import assert from "node:assert/strict";
import test from "node:test";

import { isLocalOfferListed, splitSetupCommand } from "./endpoints";

test("setup problems show their command apart from the explanation", () => {
  assert.deepEqual(
    splitSetupCommand("alice is not in the docker group. Run: sudo usermod -aG docker alice, then log in again."),
    {
      before: "alice is not in the docker group. Run: ",
      command: "sudo usermod -aG docker alice",
      after: ", then log in again."
    }
  );
  assert.deepEqual(
    splitSetupCommand('containerlab is not installed. Install it with: curl -sL https://containerlab.dev/setup | sudo -E bash -s "all"'),
    {
      before: "containerlab is not installed. Install it with: ",
      command: 'curl -sL https://containerlab.dev/setup | sudo -E bash -s "all"',
      after: ""
    }
  );
  assert.deepEqual(splitSetupCommand("docker is not installed."), { before: "docker is not installed.", after: "" });
});

test("lab hosts read by where their labs run", async () => {
  const { labHostKind, labHostSubtitle, c9sDefaultsSummary } = await import("./endpoints");
  assert.equal(labHostKind({ kind: "local" }), "this-computer");
  assert.equal(labHostKind({ kind: "local", runtime: "c9s" }), "cluster");
  assert.equal(labHostKind({ kind: "api", runtime: "c9s" }), "server");
  assert.equal(labHostSubtitle({ kind: "local", runtime: "podman" }), "This computer · Podman");
  assert.equal(
    labHostSubtitle({ kind: "local", runtime: "c9s", kubeContext: "kind-c9s-app" }),
    "Kubernetes · c9s · kind-c9s-app · one namespace per lab"
  );
  assert.equal(
    labHostSubtitle({ kind: "local", runtime: "c9s", kubeContext: "prod", namespace: "team-a" }),
    "Kubernetes · c9s · prod · namespace team-a"
  );
  assert.equal(labHostSubtitle({ kind: "api", runtime: "c9s", cluster: "c9s" }), "API Server · c9s · cluster c9s");
  assert.equal(labHostSubtitle({ kind: "api" }), "API Server");
  assert.equal(
    c9sDefaultsSummary({ exposeType: "None", persistence: true }),
    "ports exposed: None · node storage kept · no image pull secret"
  );
  assert.equal(c9sDefaultsSummary({}), "");
});

test("a listed cluster does not stand in for a hidden This computer", () => {
  const cluster = { kind: "local" as const, runtime: "c9s" as const, url: "local://cluster/kind-c9s-app" };
  const thisComputer = { kind: "local" as const, runtime: "docker" as const, url: "local://this-computer" };
  // VS Code offers This computer without an address.
  assert.equal(isLocalOfferListed([cluster], {}), false);
  assert.equal(isLocalOfferListed([cluster, thisComputer], {}), true);
  // Offers with an address match that host only.
  assert.equal(isLocalOfferListed([cluster], { url: "local://this-computer" }), false);
  assert.equal(isLocalOfferListed([cluster], { url: "local://cluster/kind-c9s-app" }), true);
  // Not answered yet: a local host without a runtime is this computer.
  assert.equal(isLocalOfferListed([{ kind: "local", url: "local://this-computer" }], {}), true);
});

test("a Kubernetes lab host on the app's machine reads as Kubernetes before its check answers", async () => {
  const { labHostKind, labHostSubtitle } = await import("./endpoints");
  // A cluster listed before its runtime is known, or kept in the browser from an earlier session.
  const cluster = { kind: "local" as const, url: "local://c9s/kind-c9s-app?kubeconfig=%2Fhome%2Fclab%2Fapp.kubeconfig" };
  assert.equal(labHostKind(cluster), "cluster");
  assert.equal(labHostSubtitle(cluster), "Kubernetes · c9s · current context · one namespace per lab");
  assert.equal(labHostKind({ kind: "local", url: "local://this-computer" }), "this-computer");
  // Listed, it is no "This computer": that one can still be added.
  assert.equal(isLocalOfferListed([cluster], {}), false);
});

test("a configured cluster the user removed can be added again under Kubernetes", async () => {
  const { clusterChoiceUnavailable, unlistedLocalOffers } = await import("./endpoints");
  const url = "local://c9s/kind-c9s-app";
  const offers = [{ url, label: "kind-c9s-app" }];
  // The web app adds no clusters itself; its configured one comes from the server.
  const webReason = "In the web app, a Kubernetes lab host comes from the server's configuration.";
  const listed = [{ kind: "local" as const, url }];
  assert.deepEqual(unlistedLocalOffers(listed, offers), []);
  assert.equal(clusterChoiceUnavailable(undefined, webReason, 0), webReason);
  // Removed: offered again, and the Kubernetes choice is open for it.
  const removed = unlistedLocalOffers([], offers);
  assert.deepEqual(removed, offers);
  assert.equal(clusterChoiceUnavailable(undefined, webReason, removed.length), undefined);
});
