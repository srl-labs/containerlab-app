import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TERMINAL_SSH_USER_MAPPING,
  DEFAULT_TERMINAL_TELNET_PORT,
  normalizeTerminalPreferences,
  resolveTerminalSshUsername
} from "./runtimeTerminalSettings";

test("normalizeTerminalPreferences falls back to defaults for invalid input", () => {
  const preferences = normalizeTerminalPreferences({
    sshUserMapping: "invalid",
    telnetPort: "nope"
  });

  assert.deepEqual(preferences.sshUserMapping, DEFAULT_TERMINAL_SSH_USER_MAPPING);
  assert.equal(preferences.telnetPort, DEFAULT_TERMINAL_TELNET_PORT);
});

test("normalizeTerminalPreferences merges custom SSH users and valid telnet port", () => {
  const preferences = normalizeTerminalPreferences({
    sshUserMapping: {
      nokia_srlinux: "clab",
      juniper_crpd: "operator"
    },
    telnetPort: 7001
  });

  assert.equal(preferences.sshUserMapping.nokia_srlinux, "clab");
  assert.equal(preferences.sshUserMapping.juniper_crpd, "operator");
  assert.equal(preferences.telnetPort, 7001);
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
