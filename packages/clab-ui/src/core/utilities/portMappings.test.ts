import assert from "node:assert/strict";
import test from "node:test";

import { joinPortMapping, portProtocol, splitPortMapping } from "./portMappings";

test("port entries split into the spec and a known protocol suffix", () => {
  assert.deepEqual(splitPortMapping("8080:80"), { spec: "8080:80", suffix: "" });
  assert.deepEqual(splitPortMapping("8022:22/ts"), { spec: "8022:22", suffix: "ts" });
  assert.deepEqual(splitPortMapping("127.0.0.1:53:53/UDP"), {
    spec: "127.0.0.1:53:53",
    suffix: "UDP"
  });
  // Not a protocol: the entry stays as written.
  assert.deepEqual(splitPortMapping("80:80/foo"), { spec: "80:80/foo", suffix: "" });
  assert.equal(portProtocol(splitPortMapping("8022:22/TS")), "ts");
  assert.equal(portProtocol(splitPortMapping("8080:80")), "tcp");
});

test("entries round-trip unchanged while the protocol is kept", () => {
  for (const entry of ["8080:80", "80:80/tcp", "8022:22/TS", "1000-1010:1000-1010/udp", "x/foo"]) {
    const mapping = splitPortMapping(entry);
    assert.equal(joinPortMapping(mapping, portProtocol(mapping)), entry);
  }
});

test("changing the protocol rewrites the suffix", () => {
  assert.equal(joinPortMapping(splitPortMapping("8022:22"), "ts"), "8022:22/ts");
  assert.equal(joinPortMapping(splitPortMapping("8022:22/ts"), "tcp"), "8022:22");
  assert.equal(joinPortMapping(splitPortMapping("53:53/tcp"), "udp"), "53:53/udp");
  assert.equal(joinPortMapping(splitPortMapping(""), "ts"), "/ts");
});
