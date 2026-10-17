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

type Step = "create" | "deploy" | "nodes" | "terminal" | "plan" | "destroy" | "running" | "cleanup";

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
    planHasChanges: () => run<boolean>("plan"),
    destroy: () => run<{ last: unknown }>("destroy"),
    isRunning: () => run<boolean>("running"),
    cleanup: () => run<undefined>("cleanup")
  };
}
