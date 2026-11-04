import assert from "node:assert/strict";
import test from "node:test";

import {
  captureDuration,
  captureLimits,
  captureNodeTargets,
  captureTargetFlags,
  describeCaptureGap,
  parseCaptureGapLine,
  parseCaptureInterfaces,
  pcapngBlocks
} from "./capture.ts";
import { captureStreamPath } from "./api/clabApiClient.ts";

/** A little-endian pcapng block of `type` with `body` padded to 32 bits. */
function pcapngBlock(type: number, body: Uint8Array): Uint8Array {
  const padded = Math.ceil(body.byteLength / 4) * 4;
  const length = 12 + padded;
  const block = new Uint8Array(length);
  const view = new DataView(block.buffer);
  view.setUint32(0, type, true);
  view.setUint32(4, length, true);
  block.set(body, 8);
  view.setUint32(length - 4, length, true);
  return block;
}

function shb(): Uint8Array {
  const body = new Uint8Array(16);
  const view = new DataView(body.buffer);
  view.setUint32(0, 0x1a2b3c4d, true);
  view.setUint16(4, 1, true);
  view.setBigInt64(8, -1n, true);
  return pcapngBlock(0x0a0d0d0a, body);
}

async function* from(chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

async function collect(iterable: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const result: Uint8Array[] = [];
  for await (const chunk of iterable) result.push(chunk);
  return result;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

test("capture targets map inspect names to nodes, in order and without duplicates", () => {
  const records = [
    { name: "demo-n1", nodeName: "n1" },
    { name: "demo-srl-a", node_name: "srl-a" }
  ];
  const targets = captureNodeTargets(
    "demo",
    [
      { containerName: "demo-srl-a", interfaceName: "ethernet-1/1" },
      { containerName: "demo-n1", interfaceName: "eth1" },
      { containerName: "demo-srl-a", interfaceName: "e1-2" },
      { containerName: "demo-n1", interfaceName: "eth1" },
      { containerName: "demo-n9", interfaceName: "eth1" },
      { containerName: "r1", interfaceName: "1/1/3" }
    ],
    records
  );
  assert.deepEqual(targets, [
    { node: "srl-a", interface: "ethernet-1/1" },
    { node: "n1", interface: "eth1" },
    { node: "srl-a", interface: "e1-2" },
    { node: "n9", interface: "eth1" },
    { node: "r1", interface: "1/1/3" }
  ]);
  assert.deepEqual(captureTargetFlags(targets), [
    "--target",
    "srl-a:ethernet-1/1,e1-2",
    "--target",
    "n1:eth1",
    "--target",
    "n9:eth1",
    "--target",
    "r1:1/1/3"
  ]);
  assert.throws(() => captureNodeTargets("demo", [], records), /At least one capture target/);
  assert.throws(
    () => captureNodeTargets("demo", [{ containerName: "demo-n1", interfaceName: " " }], records),
    /needs a node and an interface/
  );
});

test("capture limits take Go durations and the lab hosts' ranges", () => {
  assert.equal(captureDuration("5s"), "5s");
  assert.equal(captureDuration(" 1m30s "), "1m30s");
  assert.equal(captureDuration(undefined), undefined);
  assert.equal(captureDuration(""), undefined);
  for (const bad of ["5", "-5s", "0s", "5 s", "1d", "5s;rm"]) {
    assert.throws(() => captureDuration(bad), /Invalid capture duration/, bad);
  }
  assert.deepEqual(captureLimits({ duration: "10s", packetLimit: 100, snapLength: 128 }), {
    duration: "10s",
    packetLimit: 100,
    snapLength: 128
  });
  assert.throws(() => captureLimits({ packetLimit: 0 }), /packet limit/);
  assert.throws(() => captureLimits({ packetLimit: 1.5 }), /packet limit/);
  assert.throws(() => captureLimits({ snapLength: 63 }), /snap length/);
  assert.throws(() => captureLimits({ snapLength: 1_048_577 }), /snap length/);
});

test("capture interfaces parse containerlab's and clab-api-server's shapes", () => {
  assert.deepEqual(
    parseCaptureInterfaces([
      { node: "srl1", interface: "e1-1", alias: "ethernet-1/1", peer_node: "srl2", peer_interface: "ethernet-1/1" },
      { node: "n1", interface: "eth1", alias: "", peerNode: "host", peerInterface: "n1-eth1" },
      { node: "", interface: "eth2" },
      "junk"
    ]),
    [
      { node: "srl1", interface: "e1-1", alias: "ethernet-1/1", peerNode: "srl2", peerInterface: "ethernet-1/1" },
      { node: "n1", interface: "eth1", peerNode: "host", peerInterface: "n1-eth1" }
    ]
  );
  assert.deepEqual(parseCaptureInterfaces({ error: "x" }), []);
});

test("containerlab's gap warning becomes a capture gap", () => {
  const line =
    '14:00:00 WARN Capture has a gap node=r1 interfaces=e1-1,e1-2 from=2026-10-27T14:00:00.5Z to=0001-01-01T00:00:00Z reason="follow-up segment started late"';
  const gap = parseCaptureGapLine(line);
  assert.deepEqual(gap, {
    node: "r1",
    interfaces: ["e1-1", "e1-2"],
    from: "2026-10-27T14:00:00.5Z",
    reason: "follow-up segment started late"
  });
  assert.equal(
    describeCaptureGap(gap ?? {}),
    "Capture gap on r1 (e1-1, e1-2): follow-up segment started late. Packets in between are missing; the capture goes on."
  );
  assert.equal(parseCaptureGapLine("14:00:00 INFO Capture started"), undefined);
});

test("pcapng blocks are regrouped whole and a cut-off last block is dropped", async () => {
  const header = shb();
  const packet = pcapngBlock(6, new Uint8Array(30).fill(7));
  const stream = concat([header, packet, packet]);
  // Split at awkward places: inside the length field, inside a body, at a boundary.
  const parts = [stream.slice(0, 5), stream.slice(5, 40), stream.slice(40, header.byteLength + packet.byteLength), stream.slice(header.byteLength + packet.byteLength, stream.byteLength - 3)];
  const blocks = await collect(pcapngBlocks(from(parts)));
  assert.deepEqual(concat(blocks), concat([header, packet]));
  for (const chunk of blocks) assert.equal(chunk.byteLength % 4, 0);

  await assert.rejects(collect(pcapngBlocks(from([new Uint8Array(16).fill(0xff)]))), /malformed pcapng block|not pcapng/);
});

test("capture stream URLs carry one target per interface and the limits", () => {
  assert.equal(
    captureStreamPath("my lab", {
      targets: [
        { node: "srl1", interface: "ethernet-1/1" },
        { node: "sros", interface: "1/1/3" }
      ],
      duration: "5s",
      packetLimit: 10,
      snapLength: 128,
      download: true
    }),
    "/api/v1/labs/my%20lab/capture/stream?target=srl1%3Aethernet-1%2F1&target=sros%3A1%2F1%2F3&duration=5s&packetLimit=10&snapLength=128&download=1"
  );
  assert.equal(
    captureStreamPath("lab", { targets: [{ node: "n1", interface: "eth1" }] }),
    "/api/v1/labs/lab/capture/stream?target=n1%3Aeth1"
  );
});
