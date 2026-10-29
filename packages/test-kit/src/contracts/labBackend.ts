import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, test } from "node:test";

import { effectiveSupport } from "@srl-labs/containerlab-lab-backend";
import type {
  LabBackend,
  LabEvent,
  LabRuntimeKind,
  LifecycleStreamEvent,
  TerminalServerMessage,
  WorkspaceFileEvent
} from "@srl-labs/containerlab-lab-backend";

import { isIcmpFrame, parsePcapng, type ParsedPcapng } from "./pcapng";

/** One lab backend under test, on a fake or on a real lab host. */
export interface LabBackendContractFixture {
  backend: LabBackend;
  /**
   * Whether the backend can deploy labs: a real containerlab with a container
   * runtime behind it. File behaviour is checked either way.
   */
  runsLabs: boolean;
  /** Image of the contract lab's nodes; it must have a shell. */
  nodeImage?: string;
  /** The runtime the lab host must report; any known one when unset. */
  runtime?: LabRuntimeKind;
  /**
   * A lab that runs on the host, with nodes n1 and n2 linked n1:eth1 to
   * n2:eth1 and pinging each other, to capture on (a fake lab host's).
   */
  captureLab?: string;
  dispose?(): Promise<void> | void;
}

export interface LabBackendContractOptions {
  createFixture(): Promise<LabBackendContractFixture>;
  /** Time for the lab test: deploy, terminal, destroy. */
  labTimeoutMs?: number;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

async function rejectsWithStatus(promise: Promise<unknown>, status: number): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal(statusOf(error), status, `expected HTTP ${status}, got ${String(error)}`);
    return true;
  });
}

function text(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

async function nextMatching<T>(
  iterable: AsyncIterable<T>,
  matches: (value: T) => boolean,
  timeoutMs: number
): Promise<T> {
  const iterator = iterable[Symbol.asyncIterator]();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await Promise.race([
      iterator.next(),
      new Promise<IteratorResult<T>>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), Math.max(0, deadline - Date.now()))
      )
    ]);
    if (result.done) break;
    if (matches(result.value)) return result.value;
  }
  throw new Error("No matching value before the timeout");
}

async function collectLifecycle(
  events: AsyncIterable<LifecycleStreamEvent>
): Promise<{ logs: string[]; last?: LifecycleStreamEvent }> {
  const logs: string[] = [];
  let last: LifecycleStreamEvent | undefined;
  for await (const event of events) {
    if (event.type === "log") logs.push(event.line);
    else last = event;
  }
  return { logs, last };
}


async function readAll(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return new Uint8Array(Buffer.concat(chunks));
}

/** One section, an interface per target named `<node>:<interface>`, ping packets, nothing cut off. */
function assertLabLinkCapture(capture: ParsedPcapng, interfaceNames: string[]): void {
  assert.equal(capture.sections, 1, "one pcapng section");
  assert.equal(capture.trailing, 0, "the stream ends with a whole block");
  assert.deepEqual(
    capture.interfaces.map((entry) => entry.name),
    interfaceNames
  );
  assert.ok(capture.interfaces.every((entry) => entry.linkType === 1), "Ethernet interfaces");
  const icmp = capture.packets.filter((packet) => isIcmpFrame(packet.frame));
  assert.ok(icmp.length > 0, `ICMP packets in ${capture.packets.length} packets`);
  assert.ok(capture.packets.every((packet) => packet.interfaceId < interfaceNames.length));
}

/**
 * Captures n1:eth1 and n2:eth1 of a running lab for `duration`, by the
 * containers' inspect names, and checks the pcapng. Aborting a capture
 * without a duration must end its stream cleanly too.
 */
async function assertCapturesLab(backend: LabBackend, labName: string, duration: string): Promise<void> {
  const interfaces = await backend.captureInterfaces(labName);
  const n1 = interfaces.find((entry) => entry.node === "n1" && entry.interface === "eth1");
  assert.deepEqual(n1 && { peerNode: n1.peerNode, peerInterface: n1.peerInterface }, { peerNode: "n2", peerInterface: "eth1" });
  const containers = await backend.inspectLab(labName);
  const containerOf = (node: string) => {
    const container = containers.find((candidate) => candidate.name.endsWith(`-${node}`));
    assert.ok(container, `container of ${node}`);
    return container.name;
  };
  const targets = [
    { containerName: containerOf("n1"), interfaceName: "eth1" },
    { containerName: containerOf("n2"), interfaceName: "eth1" }
  ];
  const started = Date.now();
  const timed = await readAll(
    await backend.openCaptureStream(labName, { targets, duration, signal: AbortSignal.timeout(120_000) })
  );
  assert.ok(Date.now() - started < 90_000, "the capture ended with its duration");
  assertLabLinkCapture(parsePcapng(timed), ["n1:eth1", "n2:eth1"]);

  const controller = new AbortController();
  const chunks: Uint8Array[] = [];
  const open = await backend.openCaptureStream(labName, { targets: targets.slice(0, 1), signal: controller.signal });
  const stopper = setTimeout(() => controller.abort(), 3000);
  for await (const chunk of open) chunks.push(chunk);
  clearTimeout(stopper);
  const aborted = parsePcapng(new Uint8Array(Buffer.concat(chunks)));
  assert.equal(aborted.trailing, 0, "an aborted capture ends with a whole block");
  assert.deepEqual(aborted.interfaces.map((entry) => entry.name), ["n1:eth1"]);
}

export function contractLabYaml(labName: string, image: string): string {
  return `name: ${labName}
topology:
  nodes:
    n1:
      kind: linux
      image: ${image}
    n2:
      kind: linux
      image: ${image}
  links:
    - endpoints: ["n1:eth1", "n2:eth1"]
`;
}

/**
 * What every lab backend must agree on, so hosts can switch between the
 * local containerlab and clab-api-server without noticing.
 */
export function describeLabBackendContract(name: string, options: LabBackendContractOptions): void {
  async function withFixture(run: (fixture: LabBackendContractFixture, folder: string) => Promise<void>) {
    const fixture = await options.createFixture();
    const folder = `contract-${randomBytes(4).toString("hex")}`;
    try {
      await run(fixture, folder);
    } finally {
      await fixture.backend.fs.delete(folder, { recursive: true }).catch(() => {});
      await fixture.dispose?.();
    }
  }

  describe(`${name} lab backend contract`, () => {
    test("reports its runtime, and offers nothing the runtime lacks", () =>
      withFixture(async ({ backend, runtime }) => {
        const profile = await backend.hostProfile();
        assert.ok(["docker", "podman", "c9s"].includes(profile.runtime), profile.runtime);
        if (runtime) assert.equal(profile.runtime, runtime);
        const support = effectiveSupport(backend.capabilities, await backend.features());
        const containerOnly = [
          "imageManagement",
          "netem",
          "snapshots",
          "nodePause",
          "fcli",
          "edgeshark",
          "edgesharkManagement",
          "hostCapture",
          "shareTools"
        ] as const;
        for (const flag of containerOnly) {
          assert.equal(support[flag], profile.runtime !== "c9s", `${flag} on ${profile.runtime}`);
        }
        // A host that takes a timeout names its default as a duration, or a lab server leaves it out.
        if (profile.defaultTimeout !== undefined) {
          assert.match(profile.defaultTimeout, /^(?:\d+(?:\.\d+)?(?:h|m|s|ms))+$/, "defaultTimeout");
          assert.equal(support.lifecycleTimeout, true, "a host that names a default timeout takes one");
        }
        // A lab server that reports how it captures names each capture setting it owns.
        if (profile.capture) {
          assert.ok(profile.capture.wiresharkImage, "wiresharkImage");
          assert.ok(profile.capture.wiresharkPullPolicy, "wiresharkPullPolicy");
          const edgeshark = profile.runtime !== "c9s";
          assert.equal(profile.capture.packetflixPort !== undefined, edgeshark, `packetflixPort on ${profile.runtime}`);
          assert.equal(profile.capture.edgesharkEnv !== undefined, edgeshark, `edgesharkEnv on ${profile.runtime}`);
          if (profile.runtime === "c9s") assert.equal(typeof profile.noTopologyCR, "boolean", "noTopologyCR");
        }
        // c9s captures through its own stream; Docker hosts keep Edgeshark.
        assert.equal(support.captureStream, profile.runtime === "c9s", `captureStream on ${profile.runtime}`);
        assert.equal(support.wiresharkVnc, profile.runtime !== "c9s" || support.captureVnc);
        if (profile.runtime !== "c9s") {
          await rejectsWithStatus(backend.captureInterfaces("contract"), 501);
          await rejectsWithStatus(
            backend.openCaptureStream("contract", {
              targets: [{ containerName: "contract-n1", interfaceName: "eth1" }],
              signal: new AbortController().signal
            }),
            501
          );
        }
        if (profile.runtime !== "c9s") {
          assert.equal(support.c9sDeployOptions, false);
          await rejectsWithStatus(backend.exportManifests({ labName: "contract" }), 501);
        }
        if (profile.runtime === "c9s" && backend.kind === "local") {
          assert.ok(profile.namespaceMode, "a local c9s host knows its namespace mode");
          assert.equal(support.c9sDeployOptions, true);
        }
      }));

    test("captures lab links as one pcapng stream", { timeout: 60_000 }, async (t) => {
      const fixture = await options.createFixture();
      try {
        if (!fixture.captureLab) {
          t.skip("the fixture has no running lab to capture on");
          return;
        }
        await assertCapturesLab(fixture.backend, fixture.captureLab, "1s");
        await rejectsWithStatus(
          fixture.backend.openCaptureStream(fixture.captureLab, {
            targets: [{ containerName: `${fixture.captureLab}-n1`, interfaceName: "eth9" }],
            signal: new AbortController().signal
          }),
          400
        );
      } finally {
        await fixture.dispose?.();
      }
    });

    test("writes, lists, renames and deletes workspace files", () =>
      withFixture(async ({ backend }, folder) => {
        await backend.fs.mkdir(folder);
        await backend.fs.write(`${folder}/notes.txt`, "hello");
        assert.equal(text((await backend.fs.read(`${folder}/notes.txt`)).data), "hello");

        await backend.fs.mkdir(`${folder}/configs`);
        const entries = await backend.fs.list(folder);
        assert.deepEqual(
          entries.map((entry) => [entry.name, entry.kind, entry.path]),
          [
            ["configs", "directory", `${folder}/configs`],
            ["notes.txt", "file", `${folder}/notes.txt`]
          ]
        );

        await backend.fs.rename(`${folder}/notes.txt`, `${folder}/configs/notes.txt`);
        assert.equal(text((await backend.fs.read(`${folder}/configs/notes.txt`)).data), "hello");
        await rejectsWithStatus(backend.fs.read(`${folder}/notes.txt`), 404);

        await rejectsWithStatus(backend.fs.delete(`${folder}/configs`), 400);
        await backend.fs.delete(`${folder}/configs`, { recursive: true });
        assert.deepEqual(await backend.fs.list(folder), []);
      }));

    test("keeps files inside the workspace and limits reads", () =>
      withFixture(async ({ backend }, folder) => {
        await rejectsWithStatus(backend.fs.read("../outside.txt"), 400);
        await rejectsWithStatus(backend.fs.list(`${folder}/missing`), 404);
        await backend.fs.mkdir(folder);
        await backend.fs.write(`${folder}/big.txt`, "x".repeat(64));
        await rejectsWithStatus(backend.fs.read(`${folder}/big.txt`, { maxBytes: 16 }), 413);
        await rejectsWithStatus(backend.fs.write(`${folder}/no/such/dir.txt`, "x"), 400);
      }));

    test("finds a lab folder's topology under the folder name", () =>
      withFixture(async ({ backend }, folder) => {
        await backend.fs.mkdir(folder);
        await backend.fs.write(`${folder}/${folder}.clab.yml`, contractLabYaml("declared-name", "alpine:3"));
        const entry = (await backend.listTopologies()).find(
          (topology) => topology.yamlFileName === `${folder}/${folder}.clab.yml`
        );
        assert.ok(entry, "topology is listed");
        assert.equal(entry.labName, folder);
        assert.equal(entry.annotationsFileName, `${folder}/${folder}.clab.yml.annotations.json`);
        assert.equal(entry.hasAnnotations, false);

        await backend.fs.write(entry.annotationsFileName, "{}\n");
        const withAnnotations = (await backend.listTopologies()).find(
          (topology) => topology.yamlFileName === entry.yamlFileName
        );
        assert.equal(withAnnotations?.hasAnnotations, true);
      }));

    test("topology files track a document revision", () =>
      withFixture(async ({ backend }, folder) => {
        const yamlPath = `${folder}/${folder}.clab.yml`;
        await backend.fs.mkdir(folder);
        await backend.fs.write(yamlPath, contractLabYaml(folder, "alpine:3"));
        const files = backend.topologyFiles({ labName: folder, yamlPath });
        assert.equal(await files.exists(yamlPath), true);
        assert.match(await files.readFile(yamlPath), new RegExp(`name: ${folder}`));
        const before = await files.revision(yamlPath);
        assert.match(before ?? "", /^yaml=\d+-\d+;annotations=missing$/);

        await files.writeFile(`${yamlPath}.annotations.json`, "{}\n");
        const after = await files.revision(yamlPath);
        assert.notEqual(after, before);
        assert.match(after ?? "", /^yaml=\d+-\d+;annotations=\d+-\d+$/);

        await files.unlink(`${yamlPath}.annotations.json`);
        assert.equal(await files.exists(`${yamlPath}.annotations.json`), false);
      }));

    test("reports workspace changes", () =>
      withFixture(async ({ backend }, folder) => {
        await backend.fs.mkdir(folder);
        const controller = new AbortController();
        try {
          const events = await backend.fs.watch(controller.signal);
          await new Promise((resolve) => setTimeout(resolve, 200));
          await backend.fs.write(`${folder}/watched.txt`, "1");
          const event = await nextMatching<WorkspaceFileEvent>(
            events,
            (candidate) => candidate.path === `${folder}/watched.txt`,
            10_000
          );
          assert.equal(event.type, "workspace-file");
          assert.equal(event.parentPath, folder);
        } finally {
          controller.abort();
        }
      }));

    test(
      "deploys, inspects, streams, opens a terminal and destroys a lab",
      { timeout: options.labTimeoutMs ?? 300_000 },
      async (t) => {
        const fixture = await options.createFixture();
        if (!fixture.runsLabs) {
          await fixture.dispose?.();
          t.skip("the fixture does not run labs");
          return;
        }
        const { backend } = fixture;
        const labName = `contract-${randomBytes(3).toString("hex")}`;
        const yamlPath = `${labName}/${labName}.clab.yml`;
        const events = new AbortController();
        try {
          await backend.fs.mkdir(labName);
          await backend.fs.write(yamlPath, contractLabYaml(labName, fixture.nodeImage ?? "alpine:3"));

          const labEvents = await backend.events({ initialState: true }, events.signal);
          const deploy = await collectLifecycle(
            await backend.streamLifecycle("deploy", { labName, path: yamlPath })
          );
          assert.equal(deploy.last?.type, "done", JSON.stringify(deploy.last));
          assert.ok(deploy.logs.length > 0, "deploy streams containerlab logs");

          const started = await nextMatching<LabEvent>(
            labEvents,
            (event) => event.type === "container" && event.attributes?.containerlab === labName,
            30_000
          );
          assert.match(String(started.actor_name), new RegExp(`${labName}-n[12]$`));

          assert.equal(await backend.isLabRunning(labName), true);
          const containers = await backend.inspectLab(labName);
          assert.deepEqual(
            containers.map((container) => (container as unknown as { nodeName: string }).nodeName).sort(),
            ["n1", "n2"]
          );
          assert.ok((await backend.inspectAll())[labName]);

          const plan = await backend.runLifecycle("apply", { labName, path: yamlPath }, { dryRun: true });
          assert.equal((plan.result as { dryRun?: unknown }).dryRun, true);
          assert.deepEqual((plan.result as { addedNodes?: unknown }).addedNodes, []);

          const n1 = containers.find((container) => container.name.endsWith("-n1"));
          assert.ok(n1);
          const session = await backend.createTerminal(labName, n1.name, {
            protocol: "shell",
            cols: 100,
            rows: 30
          });
          assert.equal(session.protocol, "shell");
          const terminal = await backend.attachTerminal(session.sessionId);
          const output = await new Promise<string>((resolve, reject) => {
            let received = "";
            const timer = setTimeout(() => reject(new Error(`no terminal output: ${received}`)), 30_000);
            terminal.onMessage((message: TerminalServerMessage) => {
              if (message.type === "ready") {
                terminal.send({ type: "resize", cols: 120, rows: 40 });
                terminal.send({ type: "input", data: "echo contract-$((20+22))\r" });
              }
              if (message.type === "output") {
                received += Buffer.from(message.data, "base64").toString("utf8");
                if (received.includes("contract-42")) {
                  clearTimeout(timer);
                  resolve(received);
                }
              }
            });
          });
          assert.match(output, /contract-42/);
          terminal.send({ type: "input", data: "exit\r" });
          terminal.close();

          const logs = await backend.nodeLogs(labName, n1.name, { tail: "10" });
          assert.equal(logs.containerName, n1.name);

          if ((await backend.features()).captureStream) {
            // Two nodes ping across their link while it is captured for 5 s.
            await backend.exec({ labName }, { command: "ip addr add 10.255.0.1/30 dev eth1", nodeNames: ["n1"] });
            await backend.exec({ labName }, { command: "ip addr add 10.255.0.2/30 dev eth1", nodeNames: ["n2"] });
            const ping = backend.exec({ labName }, { command: "ping -c 30 -i 0.3 10.255.0.2", nodeNames: ["n1"] });
            await assertCapturesLab(backend, labName, "5s");
            await ping;
          }

          const destroy = await collectLifecycle(
            await backend.streamLifecycle("destroy", { labName }, { cleanup: true })
          );
          assert.equal(destroy.last?.type, "done", JSON.stringify(destroy.last));
          assert.equal(await backend.isLabRunning(labName), false);
        } finally {
          events.abort();
          if (await backend.isLabRunning(labName).catch(() => false)) {
            await backend.runLifecycle("destroy", { labName }, { cleanup: true }).catch(() => {});
          }
          await backend.fs.delete(labName, { recursive: true }).catch(() => {});
          await fixture.dispose?.();
        }
      }
    );
  });
}
