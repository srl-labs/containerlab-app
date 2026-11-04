/* global describe, it */
/**
 * Per lab host settings: This computer keeps the old global settings, a
 * Kubernetes lab host and an API Server their connection entry, and the
 * values that applied to every host move into the entries once.
 */
import { expect } from "chai";

import {
  entryRows,
  hostSettingKey,
  migrateConnectionEntries,
  thisComputerRows,
  toStoredValue,
  withEntrySetting
} from "../../../src/backend/hostSettings";

const isCluster = (entry: Record<string, unknown>) =>
  entry.kind === "kubernetes" || (entry.kind === "local" && entry.runtime === "c9s");

describe("lab host settings", () => {
  it("reads This computer's values from the global settings, changed where the user set them", () => {
    const user: Record<string, unknown> = {
      runtime: "podman",
      "capture.preferredAction": "Wireshark VNC"
    };
    const defaults: Record<string, unknown> = {
      runtime: "docker",
      binaryPath: "",
      "capture.preferredAction": "Automatic",
      "capture.packetflixPort": 5001
    };
    const rows = thisComputerRows((key) => ({ userValue: user[key], defaultValue: defaults[key] }));
    expect(rows.runtime).to.deep.equal({ value: "podman", defaultLabel: "Docker" });
    expect(rows.captureMethod).to.deep.equal({ value: "wireshark-vnc", defaultLabel: "Automatic" });
    expect(rows.binaryPath).to.deep.equal({ defaultLabel: "containerlab on PATH" });
    expect(rows.packetflixPort).to.deep.equal({ defaultLabel: "5001" });
    expect(rows.timeout).to.deep.equal({ defaultLabel: "2m (containerlab default)" });
  });

  it("reads a cluster's values from its entry, with defaults as placeholders", () => {
    const rows = entryRows(
      "cluster",
      {
        kind: "kubernetes",
        kubeContext: "kind-c9s-app",
        deployTimeout: "20m",
        persistence: false,
        captureMethod: "Automatic"
      },
      { binaryPath: "/opt/containerlab" }
    );
    expect(rows.timeout).to.deep.equal({
      value: "20m",
      defaultLabel: "10m (containerlab default)"
    });
    expect(rows.persistence).to.deep.equal({ value: false, defaultLabel: "On" });
    expect(rows.captureMethod).to.deep.equal({ value: "auto", defaultLabel: "Automatic" });
    expect(rows.exposeType).to.deep.equal({ defaultLabel: "clabernetes default" });
    expect(rows.binaryPath).to.deep.equal({ shown: "/opt/containerlab" });
    expect(rows.runtime).to.equal(undefined);
  });

  it("keeps an API Server's capture method only", () => {
    const rows = entryRows("server", { url: "https://lab:8090", captureMethod: "Edgeshark" });
    expect(Object.keys(rows)).to.deep.equal(["captureMethod"]);
    expect(rows.captureMethod?.value).to.equal("edgeshark");
  });

  it("knows where each kind keeps a setting", () => {
    expect(hostSettingKey("this-computer", "socket")).to.equal("dockerSocketPath");
    expect(hostSettingKey("cluster", "deployArgs")).to.equal("deployExtraArgs");
    expect(hostSettingKey("cluster", "socket")).to.equal(undefined);
    expect(hostSettingKey("server", "wiresharkImage")).to.equal(undefined);
    expect(toStoredValue("captureMethod", "local-wireshark")).to.equal(
      "Wireshark on this computer"
    );
    expect(toStoredValue("packetflixPort", "5002")).to.equal(5002);
  });

  it("drops a setting that goes back to its default", () => {
    const entry = {
      kind: "kubernetes",
      kubeContext: "c",
      persistence: false,
      deployTimeout: "20m"
    };
    expect(withEntrySetting(entry, "persistence", true)).to.deep.equal({
      kind: "kubernetes",
      kubeContext: "c",
      deployTimeout: "20m"
    });
    expect(withEntrySetting(entry, "deployTimeout", undefined)).to.deep.equal({
      kind: "kubernetes",
      kubeContext: "c",
      persistence: false
    });
    expect(withEntrySetting(entry, "noTopologyCR", true)).to.include({ noTopologyCR: true });
  });

  describe("migration", () => {
    const entries = [
      { kind: "kubernetes", kubeContext: "kind-a" },
      { kind: "local", runtime: "c9s", kubeContext: "kind-b", captureMethod: "Edgeshark" },
      { url: "https://lab:8090", label: "lab" },
      "garbage"
    ];

    it("copies the values the user set into the entries they applied to", () => {
      const next = migrateConnectionEntries(
        entries,
        {
          deployArgs: "--max-workers 2",
          captureMethod: "Wireshark VNC",
          wiresharkImage: "my/wireshark:1"
        },
        isCluster
      );
      expect(next).to.deep.equal([
        {
          kind: "kubernetes",
          kubeContext: "kind-a",
          deployExtraArgs: "--max-workers 2",
          captureMethod: "Wireshark VNC",
          wiresharkImage: "my/wireshark:1"
        },
        // An entry's own value stays.
        {
          kind: "local",
          runtime: "c9s",
          kubeContext: "kind-b",
          captureMethod: "Edgeshark",
          deployExtraArgs: "--max-workers 2",
          wiresharkImage: "my/wireshark:1"
        },
        // An API Server takes the capture method only: it runs its own containerlab and Wireshark VNC.
        { url: "https://lab:8090", label: "lab", captureMethod: "Wireshark VNC" },
        "garbage"
      ]);
    });

    it("changes nothing without values of the user's own", () => {
      expect(migrateConnectionEntries(entries, {}, isCluster)).to.equal(undefined);
      expect(migrateConnectionEntries(entries, { deployArgs: "  " }, isCluster)).to.equal(
        undefined
      );
      expect(migrateConnectionEntries([], { captureMethod: "Edgeshark" }, isCluster)).to.equal(
        undefined
      );
    });
  });
});
