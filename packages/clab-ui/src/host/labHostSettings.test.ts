import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  LAB_HOST_SETTINGS,
  SET_BY_API_SERVER,
  SET_BY_APP_CONFIGURATION,
  labHostSettingAccess,
  labHostSettingsMatrix
} from "./labHostSettings";

describe("labHostSettingsMatrix", () => {
  it("lets This computer set its runtime, arguments and Edgeshark, and greys out Kubernetes settings", () => {
    assert.deepEqual(labHostSettingsMatrix({ kind: "this-computer", runtime: "docker" }), {
      runtime: "edit",
      socket: "edit",
      binaryPath: "edit",
      kubeconfig: "unsupported",
      namespaces: "unsupported",
      timeout: "edit",
      exposeType: "unsupported",
      persistence: "unsupported",
      imagePullSecret: "unsupported",
      noTopologyCR: "unsupported",
      deployArgs: "edit",
      destroyArgs: "edit",
      captureMethod: "edit",
      wiresharkImage: "edit",
      wiresharkPullPolicy: "edit",
      vncHostname: "edit",
      edgeshark: "edit",
      captureHostname: "edit",
      packetflixPort: "edit",
      edgesharkEnv: "edit"
    });
  });

  it("lets a Kubernetes lab host set its cluster and deploy defaults, without runtime or Edgeshark", () => {
    assert.deepEqual(labHostSettingsMatrix({ kind: "cluster", runtime: "c9s", editable: true }), {
      runtime: "unsupported",
      socket: "unsupported",
      binaryPath: "fixed",
      kubeconfig: "edit",
      namespaces: "edit",
      timeout: "edit",
      exposeType: "edit",
      persistence: "edit",
      imagePullSecret: "edit",
      noTopologyCR: "edit",
      deployArgs: "edit",
      destroyArgs: "edit",
      captureMethod: "edit",
      wiresharkImage: "edit",
      wiresharkPullPolicy: "unsupported",
      vncHostname: "unsupported",
      edgeshark: "unsupported",
      captureHostname: "unsupported",
      packetflixPort: "unsupported",
      edgesharkEnv: "unsupported"
    });
  });

  it("shows a Kubernetes lab host from the app's configuration read-only", () => {
    const subject = { kind: "cluster" as const, runtime: "c9s" as const, editable: false };
    assert.deepEqual(labHostSettingAccess("namespaces", subject), { access: "fixed", reason: SET_BY_APP_CONFIGURATION });
    assert.equal(labHostSettingAccess("persistence", subject).access, "fixed");
    assert.equal(labHostSettingAccess("captureMethod", subject).access, "edit");
  });

  it("shows what a c9s API Server sets read-only, with its values", () => {
    const subject = {
      kind: "server" as const,
      runtime: "c9s" as const,
      server: {
        cluster: "c9s-prod",
        namespacePattern: "c9s-alice-{lab}",
        exposeType: "None" as const,
        persistence: false,
        defaultTimeout: "10m"
      }
    };
    assert.deepEqual(labHostSettingAccess("runtime", subject), { access: "server", reason: SET_BY_API_SERVER, value: "Kubernetes (c9s)" });
    assert.partialDeepStrictEqual(labHostSettingAccess("kubeconfig", subject), { access: "server", value: "c9s-prod" });
    assert.partialDeepStrictEqual(labHostSettingAccess("namespaces", subject), { value: "c9s-alice-{lab}" });
    assert.partialDeepStrictEqual(labHostSettingAccess("persistence", subject), { value: "Off" });
    assert.partialDeepStrictEqual(labHostSettingAccess("imagePullSecret", subject), { value: "None" });
    assert.partialDeepStrictEqual(labHostSettingAccess("timeout", subject), { access: "server", value: "10m" });
    assert.equal(labHostSettingAccess("deployArgs", subject).access, "unsupported");
    assert.equal(labHostSettingAccess("edgeshark", subject).access, "unsupported");
    assert.equal(labHostSettingAccess("captureMethod", subject).access, "edit");
  });

  it("greys out Kubernetes settings of a Docker API Server and keeps its Edgeshark", () => {
    const subject = { kind: "server" as const, runtime: "docker" as const };
    const reason = labHostSettingAccess("exposeType", subject);
    assert.deepEqual(reason, { access: "unsupported", reason: "Only for Kubernetes lab hosts. This API Server runs Docker." });
    assert.equal(labHostSettingAccess("edgeshark", subject).access, "edit");
    assert.equal(labHostSettingAccess("captureHostname", subject).access, "edit");
    assert.partialDeepStrictEqual(labHostSettingAccess("packetflixPort", subject), { access: "server" });
    assert.equal(labHostSettingAccess("socket", subject).access, "unsupported");
  });

  it("waits for a signed-out API Server to tell what it runs", () => {
    const subject = { kind: "server" as const };
    assert.deepEqual(labHostSettingAccess("runtime", subject), { access: "server", reason: SET_BY_API_SERVER });
    assert.equal(labHostSettingAccess("namespaces", subject).access, "server");
  });

  it("says why a setting is greyed out on Kubernetes", () => {
    const access = labHostSettingAccess("edgeshark", { kind: "cluster", runtime: "c9s" });
    assert.deepEqual(access, {
      access: "unsupported",
      reason: "Not supported on Kubernetes (c9s): clabernetes captures lab links as one stream."
    });
  });
});

describe("LAB_HOST_SETTINGS", () => {
  it("checks timeouts, secrets and ports", () => {
    assert.equal(LAB_HOST_SETTINGS.timeout.validate?.("30m"), undefined);
    assert.equal(LAB_HOST_SETTINGS.timeout.validate?.(""), undefined);
    assert.equal(LAB_HOST_SETTINGS.timeout.validate?.("soon"), "A duration such as 90s, 30m or 1h");
    assert.notEqual(LAB_HOST_SETTINGS.imagePullSecret.validate?.("Regcred"), undefined);
    assert.equal(LAB_HOST_SETTINGS.packetflixPort.validate?.(70000), "A port from 1 to 65535");
    assert.equal(LAB_HOST_SETTINGS.packetflixPort.validate?.(5001), undefined);
  });
});
