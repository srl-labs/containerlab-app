import type { Page } from "@playwright/test";

/** A two-node lab that only needs the alpine image. */
export function localTestTopology(labName: string): string {
  return `name: ${labName}
topology:
  nodes:
    n1: { kind: linux, image: alpine:3 }
    n2: { kind: linux, image: alpine:3 }
  links:
    - endpoints: ["n1:eth1", "n2:eth1"]
`;
}

type Step =
  | "create"
  | "deploy"
  | "nodes"
  | "terminal"
  | "terminalResume"
  | "logs"
  | "stats"
  | "plan"
  | "destroy"
  | "running"
  | "cleanup";

/**
 * Drives a lab on the app's local endpoint through the app server's routes,
 * in the app's page so its session cookie applies. The steps are what a user
 * does: write a topology, deploy, list the nodes, open a shell, plan a
 * change, destroy.
 */
export function localLabSteps(page: Page, labName: string) {
  const run = <T>(step: Step): Promise<T> =>
    page.evaluate(
      async ({ step, labName, topology }) => {
        const json = async (response: Response): Promise<any> => {
          if (!response.ok) throw new Error(`${response.url}: ${response.status} ${await response.text()}`);
          return response.json();
        };
        const { endpoints } = (await json(await fetch("auth/endpoints"))) as {
          endpoints: Array<{ id: string; kind: string }>;
        };
        const endpoint = endpoints.find((entry) => entry.kind === "local");
        if (endpoint === undefined) {
          if (step === "cleanup") return undefined;
          throw new Error("no local endpoint in this session");
        }
        const headers = { "Content-Type": "application/json", "x-endpoint-id": endpoint.id };
        const topologyRef = async (): Promise<unknown> => {
          const files = (await json(await fetch("files", { headers }))) as Array<{ labName: string; topologyRef: unknown }>;
          return files.find((entry) => entry.labName === labName)?.topologyRef;
        };
        const runningLabs = async () => json(await fetch("api/runtime/inspect/all", { headers }));
        /** The records of a stream socket until `done` says enough, the stream ends, or 30 s pass. */
        const readStream = (path: string, body: unknown, done: (records: any[]) => boolean): Promise<any[]> => {
          const url = new URL(`${path}?endpointId=${endpoint.id}`, location.href);
          url.protocol = url.protocol.replace("http", "ws");
          return new Promise((resolve, reject) => {
            const socket = new WebSocket(url);
            const records: any[] = [];
            const timer = setTimeout(() => socket.close(), 30_000);
            socket.onopen = () => socket.send(JSON.stringify(body));
            socket.onmessage = (event) => {
              const record = JSON.parse(String(event.data));
              if (record.type === "error") {
                clearTimeout(timer);
                socket.close();
                reject(new Error(`${path}: ${record.error}`));
                return;
              }
              records.push(record);
              if (done(records)) socket.close();
            };
            socket.onclose = () => {
              clearTimeout(timer);
              resolve(records);
            };
          });
        };
        /** Attaches to a terminal session and sends `input` once it is ready. */
        const attachTerminal = (sessionId: string, input: string, until: string) => {
          const streamUrl = new URL(
            `api/runtime/terminal-sessions/${sessionId}/stream?endpointId=${endpoint.id}`,
            location.href
          );
          streamUrl.protocol = streamUrl.protocol.replace("http", "ws");
          return new Promise<{ socket: WebSocket; output: string; ready: any }>((resolve, reject) => {
            const socket = new WebSocket(streamUrl);
            let output = "";
            let ready: any;
            const timer = setTimeout(() => reject(new Error(`no terminal output: ${output}`)), 30_000);
            socket.onmessage = (event) => {
              const message = JSON.parse(String(event.data));
              if (message.type === "ready") {
                ready = message;
                socket.send(JSON.stringify({ type: "input", data: input }));
              }
              if (message.type === "output") {
                output += atob(message.data);
                if (output.includes(until)) {
                  clearTimeout(timer);
                  resolve({ socket, output, ready });
                }
              }
            };
          });
        };
        const lifecycle = async (action: string, extra: Record<string, unknown> = {}) => {
          const response = await fetch(`api/lab/${action}/stream`, {
            method: "POST",
            headers,
            body: JSON.stringify({ topologyRef: await topologyRef(), ...extra })
          });
          const lines = (await response.text())
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
          return { status: response.status, logLines: lines.length - 1, last: lines.at(-1) };
        };
        switch (step) {
          case "create":
            await json(
              await fetch("api/runtime/file-explorer/directory", {
                method: "POST",
                headers,
                body: JSON.stringify({ path: labName })
              })
            );
            await json(
              await fetch(`api/runtime/file-explorer/file?path=${labName}/${labName}.clab.yml`, {
                method: "PUT",
                headers,
                body: JSON.stringify({ content: topology })
              })
            );
            return Boolean(await topologyRef());
          case "deploy":
            return lifecycle("deploy");
          case "nodes":
            return ((await runningLabs())[labName] ?? [])
              .map((container: { nodeName: string }) => container.nodeName)
              .sort();
          case "terminal": {
            const session = await json(
              await fetch("api/runtime/terminal-sessions", {
                method: "POST",
                headers,
                body: JSON.stringify({ topologyRef: await topologyRef(), nodeName: "n1", protocol: "shell", cols: 100, rows: 30 })
              })
            );
            const streamUrl = new URL(
              `api/runtime/terminal-sessions/${session.sessionId}/stream?endpointId=${endpoint.id}`,
              location.href
            );
            streamUrl.protocol = streamUrl.protocol.replace("http", "ws");
            return new Promise<boolean>((resolve, reject) => {
              const socket = new WebSocket(streamUrl);
              let output = "";
              const timer = setTimeout(() => reject(new Error(`no terminal output: ${output}`)), 30_000);
              socket.onmessage = (event) => {
                const message = JSON.parse(String(event.data));
                if (message.type === "ready") {
                  socket.send(JSON.stringify({ type: "input", data: "echo local-$((40+2))\r" }));
                }
                if (message.type === "output") {
                  output += atob(message.data);
                  if (output.includes("local-42")) {
                    clearTimeout(timer);
                    socket.send(JSON.stringify({ type: "input", data: "exit\r" }));
                    resolve(true);
                  }
                }
              };
            });
          }
          case "terminalResume": {
            // A dropped connection leaves a resumable session running; attaching again replays it.
            const createShell = async (resumable: boolean) =>
              json(
                await fetch("api/runtime/terminal-sessions", {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                    topologyRef: await topologyRef(),
                    nodeName: "n1",
                    protocol: "shell",
                    cols: 100,
                    rows: 30,
                    ...(resumable ? { resumable: true } : {})
                  })
                })
              );
            const session = await createShell(true);
            const first = await attachTerminal(session.sessionId, "echo before-$((40+2))\r", "before-42");
            first.socket.close();
            await new Promise((resolve) => setTimeout(resolve, 500));
            const second = await attachTerminal(session.sessionId, "echo after-$((40+2))\r", "after-42");
            second.socket.send(JSON.stringify({ type: "close" }));
            // A client that does not ask for it, like an older page, ends its session by disconnecting.
            const plain = await createShell(false);
            const plainShell = await attachTerminal(plain.sessionId, "echo plain-$((40+2))\r", "plain-42");
            plainShell.socket.close();
            await new Promise((resolve) => setTimeout(resolve, 500));
            const plainInfo = await fetch(`api/runtime/terminal-sessions/${plain.sessionId}`, { headers });
            return {
              resumable: first.ready.resumable === true,
              replayed: second.ready.replay === true && second.output.includes("before-42"),
              plainEndsOnDisconnect:
                plainShell.ready.resumable !== true &&
                (plainInfo.status === 404 || (await plainInfo.json()).state === "closed")
            };
          }
          case "logs": {
            // A shell writes a line to the container's log, which the stream must then show.
            const session = await json(
              await fetch("api/runtime/terminal-sessions", {
                method: "POST",
                headers,
                body: JSON.stringify({ topologyRef: await topologyRef(), nodeName: "n1", protocol: "shell", cols: 100, rows: 30 })
              })
            );
            const shell = await attachTerminal(
              session.sessionId,
              "echo clab-log-$((40+2)) >/proc/1/fd/1; echo written-$((1+1))\r",
              "written-2"
            );
            shell.socket.send(JSON.stringify({ type: "close" }));
            const records = await readStream(
              "api/runtime/logs/socket",
              { topologyRef: await topologyRef(), nodeName: "n1", tail: "20" },
              (lines) => lines.some((line) => line.type === "line" && String(line.line).includes("clab-log-42"))
            );
            return records.some((record) => record.type === "line" && String(record.line).includes("clab-log-42"));
          }
          case "stats": {
            const records = await readStream(
              "api/runtime/stats/socket",
              { topologyRef: await topologyRef(), intervalSeconds: 1 },
              (samples) => samples.filter((sample) => sample.type === "stats").length >= 2
            );
            const last = records.filter((sample) => sample.type === "stats").at(-1);
            return (last?.nodes ?? [])
              .filter((node: { cpuPercent?: number; memoryBytes: number }) => node.cpuPercent !== undefined && node.memoryBytes > 0)
              .map((node: { nodeName: string }) => node.nodeName)
              .sort();
          }
          case "plan":
            return (
              await json(
                await fetch("api/lab/apply", {
                  method: "POST",
                  headers,
                  body: JSON.stringify({ topologyRef: await topologyRef(), dryRun: true })
                })
              )
            ).changesPending;
          case "destroy":
            return lifecycle("destroy", { cleanup: true });
          case "running":
            return labName in (await runningLabs());
          case "cleanup": {
            // Leaves no lab or topology behind, also when a test failed half way.
            const ref = await topologyRef();
            if (ref !== undefined && labName in (await runningLabs())) {
              await fetch("api/lab/destroy", { method: "POST", headers, body: JSON.stringify({ topologyRef: ref, cleanup: true }) });
            }
            await fetch(`api/runtime/file-explorer/file?path=${labName}&recursive=true`, {
              method: "DELETE",
              headers: { "x-endpoint-id": endpoint.id }
            });
            return undefined;
          }
        }
        throw new Error(`unknown step ${String(step)}`);
      },
      { step, labName, topology: localTestTopology(labName) }
    ) as Promise<T>;

  return {
    create: () => run<boolean>("create"),
    deploy: () => run<{ status: number; logLines: number; last: unknown }>("deploy"),
    nodes: () => run<string[]>("nodes"),
    openShell: () => run<boolean>("terminal"),
    resumeShell: () =>
      run<{ resumable: boolean; replayed: boolean; plainEndsOnDisconnect: boolean }>("terminalResume"),
    followsLogs: () => run<boolean>("logs"),
    statsNodes: () => run<string[]>("stats"),
    planHasChanges: () => run<boolean>("plan"),
    destroy: () => run<{ last: unknown }>("destroy"),
    isRunning: () => run<boolean>("running"),
    cleanup: () => run<undefined>("cleanup")
  };
}
