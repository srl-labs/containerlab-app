import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, test, type TestContext } from "node:test";

import { FCLING_IMAGE } from "@containerlab/clab-ui/fabric/engine";

import { LocalFcling, fclingContainerName, parseEngineContainer } from "./fcling.ts";
import { LocalLabBackend } from "./localLabBackend.ts";
import type { ResolvedLocalOptions } from "./options.ts";
import { fcling as runReport } from "./tools.ts";

interface FakeRuntime {
  options: ResolvedLocalOptions;
  engines: LocalFcling;
  /** Every command the runtime was given. */
  commands(): Promise<string[][]>;
  /** What `inspect` answers from now on; nothing means there is no such container. */
  setContainer(container: unknown): Promise<void>;
  /** Makes `run` fail. */
  failRun(): Promise<void>;
}

/** A `docker` command that records its arguments and answers from files the test writes. */
async function fakeRuntime(t: TestContext): Promise<FakeRuntime> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fake-docker-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const inspected = path.join(directory, "inspect.json");
  const log = path.join(directory, "commands");
  await fs.writeFile(
    path.join(directory, "docker"),
    [
      "#!/bin/sh",
      `for arg in "$@"; do printf '%s\\t' "$arg" >> "${log}"; done`,
      `printf '\\n' >> "${log}"`,
      'case "$1" in',
      `  inspect) [ -f "${inspected}" ] && cat "${inspected}" && exit 0; echo 'no such container' >&2; exit 1 ;;`,
      `  run) [ -f "${directory}/fail-run" ] && { echo 'pull refused' >&2; exit 1; }; echo abc123 ;;`,
      "  logs) echo 'lists no nodes' ;;",
      "esac",
      "exit 0"
    ].join("\n"),
    { mode: 0o755 }
  );
  const options = {
    runtime: "docker",
    workspaceRoot: directory,
    env: { PATH: `${directory}:${process.env.PATH ?? ""}` }
  } as unknown as ResolvedLocalOptions;
  return {
    options,
    engines: new LocalFcling(options),
    async commands() {
      const text = await fs.readFile(log, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter(Boolean)
        .map((line) => line.replace(/\t$/, "").split("\t"));
    },
    async setContainer(container) {
      await fs.writeFile(inspected, JSON.stringify([container]));
    },
    async failRun() {
      await fs.writeFile(path.join(directory, "fail-run"), "");
    }
  };
}

function runningContainer(port: number, token = "secret") {
  return {
    Config: { Image: "ghcr.io/srl-labs/fcling:0.9.0", Env: ["PATH=/bin", `FCLI_API_TOKEN=${token}`] },
    State: { Running: true, ExitCode: 0, StartedAt: "2026-11-05T14:00:00Z" },
    NetworkSettings: { Ports: { "8765/tcp": [{ HostIp: "127.0.0.1", HostPort: String(port) }] } }
  };
}

/** A stand-in for the engine's HTTP API that records what it was asked. */
async function fakeEngine(
  t: TestContext,
  answer: (request: IncomingMessage, url: URL) => { status?: number; body: string }
): Promise<{ port: number; requests: IncomingMessage[]; server: Server }> {
  const requests: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    requests.push(request);
    const { status = 200, body } = answer(request, new URL(request.url ?? "/", "http://engine"));
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { port: (server.address() as AddressInfo).port, requests, server };
}

describe("parseEngineContainer", () => {
  test("reads the port and the token back from the container", () => {
    assert.deepEqual(parseEngineContainer(JSON.stringify([runningContainer(49153)])), {
      running: true,
      exitCode: 0,
      image: "ghcr.io/srl-labs/fcling:0.9.0",
      startedAt: "2026-11-05T14:00:00Z",
      url: "http://127.0.0.1:49153",
      token: "secret"
    });
  });

  test("has no port for a container that exited", () => {
    const container = parseEngineContainer(
      JSON.stringify([{ State: { Running: false, ExitCode: 2 }, NetworkSettings: { Ports: {} } }])
    );
    assert.equal(container?.running, false);
    assert.equal(container?.url, undefined);
  });
});

describe("LocalFcling", () => {
  test("starts an engine with its own volume, on a port of this machine, not as a lab node", async (t) => {
    const runtime = await fakeRuntime(t);
    await runtime.engines.start("lab1", "/labs/lab1.clab.yml", "custom-mgmt");
    const run = (await runtime.commands()).find((command) => command[0] === "run");
    assert.ok(run);
    const joined = run.join(" ");
    assert.match(joined, /--name clab-lab1-fcling/);
    assert.match(joined, /--label clab-fcling-lab=lab1/);
    assert.doesNotMatch(joined, /containerlab=/);
    assert.match(joined, /--network custom-mgmt/);
    assert.match(joined, /-p 127\.0\.0\.1::8765/);
    assert.match(joined, /-v \/labs\/lab1\.clab\.yml:\/topo\.yml:ro/);
    assert.match(joined, /-v clab-lab1-fcling:\/state/);
    assert.match(joined, /-e FCLI_API_TOKEN=[0-9a-f]{48}/);
    assert.match(joined, /-t \/topo\.yml serve --host 0\.0\.0\.0 --no-tls --persist-acks$/);
    // The token is all it is given: no other credentials reach the container.
    assert.equal(run.filter((arg) => arg === "-e").length, 1);
  });

  test("leaves the gNMI port to fcling until one is chosen", async (t) => {
    const runtime = await fakeRuntime(t);
    assert.equal((await runtime.engines.status("lab1")).gnmiPort, 57400);
    await runtime.engines.start("lab1", "/labs/lab1.clab.yml", "clab");
    const run = (await runtime.commands()).find((command) => command[0] === "run");
    assert.match(run?.join(" ") ?? "", /--label clab-fcling-gnmi-port=57400/);
    assert.match(run?.join(" ") ?? "", new RegExp(`${FCLING_IMAGE} -t /topo\\.yml serve`));
  });

  test("starts on a chosen gNMI port, and keeps it for the next engine and the reports", async (t) => {
    const runtime = await fakeRuntime(t);
    await runtime.engines.start("lab1", "/labs/lab1.clab.yml", "clab", 57410);
    await runtime.engines.start("lab1", "/labs/lab1.clab.yml", "clab");
    const runs = (await runtime.commands()).filter((command) => command[0] === "run");
    assert.equal(runs.length, 2);
    for (const run of runs) {
      assert.match(run.join(" "), /--label clab-fcling-gnmi-port=57410/);
      assert.match(run.join(" "), new RegExp(`${FCLING_IMAGE} -p 57410 -t /topo\\.yml serve`));
    }
    assert.equal(await runtime.engines.gnmiPort("lab1"), 57410);
    assert.equal((await runtime.engines.status("lab1")).gnmiPort, 57410);
    assert.equal(await runtime.engines.gnmiPort("lab2"), 57400);
  });

  test("a report goes to the gNMI port it is given, before its command", async (t) => {
    const runtime = await fakeRuntime(t);
    await runReport(runtime.options, "/t.yml", "clab", "bgp-peers -d", 57410);
    await runReport(runtime.options, "/t.yml", "clab", "lldp", 57400);
    const [chosen, standard] = (await runtime.commands()).map((command) => command.join(" "));
    assert.match(chosen ?? "", new RegExp(`${FCLING_IMAGE} -p 57410 -t /topo\\.yml bgp-peers -d$`));
    assert.match(standard ?? "", new RegExp(`${FCLING_IMAGE} -t /topo\\.yml lldp$`));
  });

  test("refuses what is not a gNMI port", async (t) => {
    const runtime = await fakeRuntime(t);
    await assert.rejects(runtime.engines.start("lab1", "/t.yml", "clab", 70000), /between 1 and 65535/);
    assert.deepEqual(await runtime.commands(), []);
  });

  test("replaces a running engine on another gNMI port, and keeps its history", async (t) => {
    const runtime = await fakeRuntime(t);
    await runtime.setContainer({
      ...runningContainer(1),
      Config: { ...runningContainer(1).Config, Labels: { "clab-fcling-gnmi-port": "57400" } }
    });
    await runtime.engines.start("lab1", "/t.yml", "clab", 57410);
    const commands = (await runtime.commands()).map((command) => command.join(" "));
    const stop = commands.indexOf("stop -t 5 clab-lab1-fcling");
    const remove = commands.indexOf("rm -f clab-lab1-fcling");
    const run = commands.findIndex((command) => command.startsWith("run "));
    assert.ok(stop >= 0 && stop < remove && remove < run, commands.join("\n"));
    assert.equal(commands.some((command) => command.startsWith("volume")), false);
  });

  test("leaves a running engine alone on its own gNMI port, or when none is asked for", async (t) => {
    const runtime = await fakeRuntime(t);
    await runtime.setContainer({
      ...runningContainer(1),
      Config: { ...runningContainer(1).Config, Labels: { "clab-fcling-gnmi-port": "57410" } }
    });
    await runtime.engines.start("lab1", "/t.yml", "clab", 57410);
    await runtime.engines.start("lab1", "/t.yml", "clab");
    assert.equal((await runtime.engines.status("lab1")).gnmiPort, 57410);
    const commands = await runtime.commands();
    assert.equal(commands.some((command) => command[0] === "run" || command[0] === "stop"), false);
  });

  test("runs the pinned image, and pulls it only when it is missing", async (t) => {
    const runtime = await fakeRuntime(t);
    await runtime.engines.start("lab1", "/labs/lab1.clab.yml", "clab");
    const run = (await runtime.commands()).find((command) => command[0] === "run");
    assert.ok(run);
    assert.equal(run[run.indexOf("--pull") + 1], "missing");
    assert.ok(run.includes(FCLING_IMAGE));
    assert.match(FCLING_IMAGE, /:\d+\.\d+\.\d+$/);
  });

  test("says why an engine did not start", async (t) => {
    const runtime = await fakeRuntime(t);
    await runtime.failRun();
    await assert.rejects(
      runtime.engines.start("lab1", "/labs/lab1.clab.yml", "clab"),
      /did not start: pull refused/
    );
  });

  test("finds a running engine instead of starting another", async (t) => {
    const runtime = await fakeRuntime(t);
    const engine = await fakeEngine(t, () => ({ body: "{}" }));
    await runtime.setContainer(runningContainer(engine.port));
    const status = await runtime.engines.start("lab1", "/labs/lab1.clab.yml", "clab");
    assert.equal(status.state, "ready");
    assert.equal((await runtime.commands()).some((command) => command[0] === "run"), false);
  });

  test("replaces an engine that failed", async (t) => {
    const runtime = await fakeRuntime(t);
    await runtime.setContainer({ State: { Running: false, ExitCode: 1 } });
    await runtime.engines.start("lab1", "/labs/lab1.clab.yml", "clab");
    const verbs = (await runtime.commands()).map((command) => command[0]);
    assert.ok(verbs.indexOf("rm") < verbs.indexOf("run"));
    assert.ok(verbs.includes("rm"));
  });

  test("tells its states apart", async (t) => {
    const runtime = await fakeRuntime(t);
    assert.deepEqual(await runtime.engines.status("lab1"), { state: "stopped", gnmiPort: 57400 });

    await runtime.setContainer({ State: { Running: false, ExitCode: 0 } });
    assert.deepEqual(await runtime.engines.status("lab1"), { state: "stopped", gnmiPort: 57400 });

    await runtime.setContainer({ State: { Running: false, ExitCode: 1 } });
    const failed = await runtime.engines.status("lab1");
    assert.equal(failed.state, "failed");
    assert.equal(failed.error, "lists no nodes");

    // Nothing answers on this port yet.
    const closed = await fakeEngine(t, () => ({ body: "{}" }));
    await new Promise((resolve) => closed.server.close(resolve));
    await runtime.setContainer(runningContainer(closed.port));
    assert.equal((await runtime.engines.status("lab1")).state, "starting");

    const engine = await fakeEngine(t, () => ({ body: "{}" }));
    await runtime.setContainer(runningContainer(engine.port));
    assert.equal((await runtime.engines.status("lab1")).state, "ready");
  });

  test("calls the API with the engine's token, and hands back its error status", async (t) => {
    const runtime = await fakeRuntime(t);
    const engine = await fakeEngine(t, (_request, url) =>
      url.pathname === "/api/reports/nope"
        ? { status: 404, body: '{"error":"no such report"}' }
        : { body: JSON.stringify({ query: url.search }) }
    );
    await runtime.setContainer(runningContainer(engine.port, "the-token"));

    assert.deepEqual(
      await runtime.engines.api("lab1", {
        method: "GET",
        path: "reports/bgp-peers",
        query: { table: "1", node: ["leaf1", "leaf2"] }
      }),
      { status: 200, body: { query: "?table=1&node=leaf1&node=leaf2" } }
    );
    assert.equal(engine.requests[0]?.headers.authorization, "Bearer the-token");
    assert.deepEqual(await runtime.engines.api("lab1", { method: "GET", path: "reports/nope" }), {
      status: 404,
      body: { error: "no such report" }
    });
  });

  test("never reaches chat or MCP", async (t) => {
    const runtime = await fakeRuntime(t);
    const engine = await fakeEngine(t, () => ({ body: "{}" }));
    await runtime.setContainer(runningContainer(engine.port));
    for (const [method, requestPath] of [
      ["POST", "chat"],
      ["POST", "../mcp"],
      ["GET", "openapi.json"]
    ] as const) {
      await assert.rejects(
        runtime.engines.api("lab1", { method: method as "POST", path: requestPath }),
        (error: Error & { status?: number }) => error.status === 403
      );
    }
    assert.equal(engine.requests.length, 0);
  });

  test("says when the engine is not running", async (t) => {
    const runtime = await fakeRuntime(t);
    await assert.rejects(
      runtime.engines.api("lab1", { method: "GET", path: "status" }),
      (error: Error & { status?: number }) => error.status === 409
    );
  });

  test("keeps the history when stopping, and deletes it with the lab", async (t) => {
    const runtime = await fakeRuntime(t);
    await runtime.engines.stop("lab1");
    assert.deepEqual(await runtime.commands(), [["rm", "-f", fclingContainerName("lab1")]]);

    await runtime.engines.stop("lab1", { deleteHistory: true });
    assert.deepEqual((await runtime.commands()).at(-1), ["volume", "rm", "clab-lab1-fcling"]);
  });

  test("follows the engine's events from where it left off", async (t) => {
    const runtime = await fakeRuntime(t);
    const engine = await fakeEngine(t, () => ({
      body: 'event: change\ndata: {"type":"change","seq":9}\n\n'
    }));
    await runtime.setContainer(runningContainer(engine.port));
    const seen: unknown[] = [];
    const stream = await runtime.engines.events("lab1", { after: 8, signal: new AbortController().signal });
    for await (const event of stream) seen.push(event);
    assert.deepEqual(seen, [{ type: "change", seq: 9 }]);
    assert.equal(engine.requests[0]?.url, "/api/events?after=8");
  });
});

describe("a lab's lifecycle and its engine", () => {
  /** A backend whose `docker` and `containerlab` record what they are asked. */
  async function backendWithRuntime(t: TestContext) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "fake-lab-host-"));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    await fs.mkdir(path.join(directory, "lab1"));
    await fs.writeFile(
      path.join(directory, "lab1", "lab1.clab.yml"),
      "name: lab1\ntopology:\n  nodes: {}\n"
    );
    const log = path.join(directory, "commands");
    for (const name of ["docker", "containerlab"]) {
      await fs.writeFile(
        path.join(directory, name),
        `#!/bin/sh\necho "${name} $*" >> "${log}"\n[ "$1" = inspect ] && echo '[]'\nexit 0\n`,
        { mode: 0o755 }
      );
    }
    const backend = new LocalLabBackend({
      workspaceRoot: directory,
      binaryPath: path.join(directory, "containerlab"),
      env: { PATH: `${directory}:${process.env.PATH ?? ""}` }
    });
    return {
      backend,
      topology: path.join(directory, "lab1", "lab1.clab.yml"),
      lab: { labName: "lab1", path: "lab1/lab1.clab.yml" },
      commands: async () =>
        (await fs.readFile(log, "utf8").catch(() => "")).split("\n").filter((line) => line.startsWith("docker ")),
      clearCommands: () => fs.rm(log, { force: true })
    };
  }

  test("destroying a lab removes its engine and history", async (t) => {
    const { backend, lab, commands } = await backendWithRuntime(t);
    await backend.runLifecycle("destroy", lab).catch(() => undefined);
    const seen = await commands();
    assert.ok(seen.includes("docker rm -f clab-lab1-fcling"), seen.join("\n"));
    assert.ok(seen.includes("docker volume rm clab-lab1-fcling"), seen.join("\n"));
  });

  test("a lab named only by its topology file, as VS Code does it, has its engine found", async (t) => {
    const { backend, commands, clearCommands, topology } = await backendWithRuntime(t);
    const byFile = { labName: "", path: topology };
    await backend.fclingEngine(byFile);
    assert.ok((await commands()).some((line) => line.includes("clab-lab1-fcling")));
    await clearCommands();
    await backend.runLifecycle("destroy", byFile).catch(() => undefined);
    const seen = await commands();
    assert.ok(seen.includes("docker rm -f clab-lab1-fcling"), seen.join("\n"));
    assert.ok(seen.includes("docker volume rm clab-lab1-fcling"), seen.join("\n"));
  });

  test("what replaces a lab's nodes removes its engine and keeps the history", async (t) => {
    const { backend, lab, commands, clearCommands } = await backendWithRuntime(t);
    for (const [action, options] of [
      ["redeploy", {}],
      ["deploy", { cleanup: true }],
      ["apply", {}]
    ] as const) {
      await clearCommands();
      await backend.runLifecycle(action, lab, options).catch(() => undefined);
      const seen = await commands();
      assert.ok(seen.includes("docker rm -f clab-lab1-fcling"), `${action}: ${seen.join("\n")}`);
      assert.equal(seen.includes("docker volume rm clab-lab1-fcling"), false, action);
    }
  });

  test("what leaves the nodes alone leaves the engine alone", async (t) => {
    const { backend, lab, commands, clearCommands } = await backendWithRuntime(t);
    for (const [action, options] of [
      ["deploy", {}],
      ["apply", { dryRun: true }],
      ["stop", {}],
      ["start", {}]
    ] as const) {
      await clearCommands();
      await backend.runLifecycle(action, lab, options).catch(() => undefined);
      assert.equal((await commands()).some((line) => line.includes("fcling")), false, action);
    }
  });
});
