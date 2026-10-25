import assert from "node:assert/strict";
import test from "node:test";

import { gottyOptionsError, sshxReadOnlyLink } from "./shareOptions.ts";

test("GoTTY options accept safe credentials, shells and ports", () => {
  assert.equal(gottyOptionsError({}), undefined);
  assert.equal(gottyOptionsError({ port: 8081, username: "lab.user", password: "S3cret!-x", shell: "/bin/sh" }), undefined);
  assert.equal(gottyOptionsError({ shell: "zsh" }), undefined);
});

test("GoTTY options reject values that would break containerlab's shell command", () => {
  const unsafe = [
    { username: "a'; rm -rf /", password: "x" },
    { username: "alice", password: "$(id)" },
    { username: "alice", password: "two words" },
    { username: "alice", password: "#comment" },
    { username: "alice", password: "-flag" },
    { username: "alice", password: "~root" },
    { username: "alice", password: "line\nbreak" },
    { username: "al ice", password: "x" },
    { shell: "bash -c id" },
    { shell: "../../bin/sh" },
    { shell: "`id`" }
  ];
  for (const options of unsafe) {
    assert.ok(gottyOptionsError(options), JSON.stringify(options));
  }
});

test("GoTTY credentials come in pairs and ports stay in range", () => {
  assert.match(gottyOptionsError({ username: "alice" }) ?? "", /both/);
  assert.match(gottyOptionsError({ password: "secret" }) ?? "", /both/);
  assert.match(gottyOptionsError({ port: 0 }) ?? "", /port/);
  assert.match(gottyOptionsError({ port: 70000 }) ?? "", /port/);
});

test("the sshx read-only link keeps only the first key", () => {
  assert.equal(sshxReadOnlyLink("https://sshx.io/s/abc#read,write"), "https://sshx.io/s/abc#read");
  assert.equal(sshxReadOnlyLink("https://sshx.io/s/abc#onlykey"), undefined);
  assert.equal(sshxReadOnlyLink("https://sshx.io/s/abc"), undefined);
});
