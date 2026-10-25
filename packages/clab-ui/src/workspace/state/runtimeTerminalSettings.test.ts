import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TERMINAL_FONT_SIZE,
  DEFAULT_TERMINAL_SSH_USER_MAPPING,
  DEFAULT_TERMINAL_TELNET_PORT,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  TERMINAL_FONT_SIZE_PRESETS,
  normalizeTerminalPreferences,
  resolveTerminalSshUsername
} from "./runtimeTerminalSettings";

test("normalizeTerminalPreferences falls back to defaults for invalid input", () => {
  const preferences = normalizeTerminalPreferences({
    sshUserMapping: "invalid",
    telnetPort: "nope",
    fontSize: "nope"
  });

  assert.deepEqual(preferences.sshUserMapping, DEFAULT_TERMINAL_SSH_USER_MAPPING);
  assert.equal(preferences.telnetPort, DEFAULT_TERMINAL_TELNET_PORT);
  assert.equal(preferences.fontSize, DEFAULT_TERMINAL_FONT_SIZE);
});

test("normalizeTerminalPreferences merges custom SSH users and keeps valid telnet port and font size", () => {
  const preferences = normalizeTerminalPreferences({
    sshUserMapping: {
      nokia_srlinux: "clab",
      juniper_crpd: "operator"
    },
    telnetPort: 7001,
    fontSize: 15
  });

  assert.equal(preferences.sshUserMapping.nokia_srlinux, "clab");
  assert.equal(preferences.sshUserMapping.juniper_crpd, "operator");
  assert.equal(preferences.telnetPort, 7001);
  assert.equal(preferences.fontSize, 15);
});

test("normalizeTerminalPreferences clamps font size to supported bounds", () => {
  const tooSmall = normalizeTerminalPreferences({ fontSize: MIN_TERMINAL_FONT_SIZE - 9 });
  const tooLarge = normalizeTerminalPreferences({ fontSize: MAX_TERMINAL_FONT_SIZE + 9 });

  assert.equal(tooSmall.fontSize, MIN_TERMINAL_FONT_SIZE);
  assert.equal(tooLarge.fontSize, MAX_TERMINAL_FONT_SIZE);
});

test("terminal font presets stay within supported bounds", () => {
  for (const preset of TERMINAL_FONT_SIZE_PRESETS) {
    assert.ok(preset >= MIN_TERMINAL_FONT_SIZE);
    assert.ok(preset <= MAX_TERMINAL_FONT_SIZE);
  }
});

test("resolveTerminalSshUsername prefers configured mapping for known kinds", () => {
  const preferences = normalizeTerminalPreferences({
    sshUserMapping: {
      nokia_srlinux: "ops"
    }
  });

  assert.equal(resolveTerminalSshUsername("nokia_srlinux", preferences), "ops");
  assert.equal(resolveTerminalSshUsername("cisco_xrd", preferences), "clab");
  assert.equal(resolveTerminalSshUsername("", preferences), undefined);
});

test("default SSH users follow containerlab's default credentials", () => {
  const preferences = normalizeTerminalPreferences(undefined);

  assert.equal(resolveTerminalSshUsername("cisco_xrv9k", preferences), "clab");
  assert.equal(resolveTerminalSshUsername("cisco_c8000", preferences), "cisco");
  assert.equal(resolveTerminalSshUsername("ciena_saos", preferences), "diag");
  assert.equal(resolveTerminalSshUsername("arrcus_arcos", preferences), "clab");
  assert.equal(resolveTerminalSshUsername("nvidia_cumulusvx", preferences), "cumulus");
  assert.equal(resolveTerminalSshUsername("fdio_vpp", preferences), "root");
  assert.equal(resolveTerminalSshUsername("juniper_csrx", preferences), "root");
  assert.equal(resolveTerminalSshUsername("generic_vm", preferences), "clab");
  assert.equal(Object.hasOwn(preferences.sshUserMapping, "cisco_xr9vk"), false);
});

test("saved settings with the misspelled cisco_xr9vk key apply to cisco_xrv9k", () => {
  const migrated = normalizeTerminalPreferences({ sshUserMapping: { cisco_xr9vk: "ops" } });
  assert.equal(migrated.sshUserMapping.cisco_xrv9k, "ops");
  assert.equal(Object.hasOwn(migrated.sshUserMapping, "cisco_xr9vk"), false);

  const corrected = normalizeTerminalPreferences({
    sshUserMapping: { cisco_xr9vk: "clab", cisco_xrv9k: "admin" }
  });
  assert.equal(corrected.sshUserMapping.cisco_xrv9k, "admin");
});
