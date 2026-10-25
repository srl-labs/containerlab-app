import assert from "node:assert/strict";
import test from "node:test";

import { splitSetupCommand } from "./endpoints";

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
