import type { Readable, Writable } from "node:stream";

import { ApisApi, Exec, Metrics, PortForward, type KubeConfig } from "@kubernetes/client-node";

/** A stream to the cluster that the caller closes. */
export interface KubeStream {
  close(): void;
}

/** CPU and memory of one container, as metrics.k8s.io reports them. */
interface KubeContainerMetrics {
  name: string;
  cpu: string;
  memory: string;
}

export interface KubePodMetrics {
  pod: string;
  containers: KubeContainerMetrics[];
}

/**
 * The Kubernetes calls KubeNodeAccess makes: byte transport for terminals
 * and port-forwards, and pod metrics. Tests replace it with a fake.
 */
export interface KubeClient {
  /** Runs `command` in a container; `onExit` gets the exit code when it ends. */
  exec(request: {
    namespace: string;
    pod: string;
    container: string;
    command: string[];
    stdout: Writable;
    stderr: Writable | null;
    stdin: Readable;
    tty: boolean;
    onExit(exitCode: number | null, error?: string): void;
  }): Promise<KubeStream>;
  /** Forwards one TCP connection to a pod port: `input` to the pod, the pod to `output`. */
  portForward(request: {
    namespace: string;
    pod: string;
    port: number;
    output: Writable;
    input: Readable;
  }): Promise<KubeStream>;
  /** Whether the cluster serves metrics.k8s.io. */
  hasMetricsApi(): Promise<boolean>;
  podMetrics(namespace: string): Promise<KubePodMetrics[]>;
}

/** The exit code of an exec's final status: 0 on Success, else the ExitCode cause. */
export function execExitCode(status: {
  status?: string;
  message?: string;
  details?: { causes?: Array<{ reason?: string; message?: string }> };
}): { exitCode: number | null; error?: string } {
  if (status.status === "Success") return { exitCode: 0 };
  const cause = status.details?.causes?.find((entry) => entry.reason === "ExitCode");
  const exitCode = cause?.message !== undefined ? Number(cause.message) : Number.NaN;
  if (Number.isInteger(exitCode)) return { exitCode };
  return { exitCode: null, ...(status.message ? { error: status.message } : {}) };
}

/** A KubeClient over @kubernetes/client-node for one kubeconfig. */
export function createKubeClient(config: KubeConfig): KubeClient {
  const exec = new Exec(config);
  const portForward = new PortForward(config, true);
  const metrics = new Metrics(config);
  return {
    async exec(request) {
      const socket = await exec.exec(
        request.namespace,
        request.pod,
        request.container,
        request.command,
        request.stdout,
        request.stderr,
        request.stdin,
        request.tty,
        (status) => {
          const { exitCode, error } = execExitCode(status);
          request.onExit(exitCode, error);
        }
      );
      socket.on("close", () => request.onExit(null));
      return { close: () => socket.close() };
    },
    async portForward(request) {
      const result = await portForward.portForward(
        request.namespace,
        request.pod,
        [request.port],
        request.output,
        null,
        request.input
      );
      const socket = typeof result === "function" ? result() : result;
      return { close: () => socket?.close() };
    },
    async hasMetricsApi() {
      const groups = await config.makeApiClient(ApisApi).getAPIVersions();
      return groups.groups.some((group) => group.name === "metrics.k8s.io");
    },
    async podMetrics(namespace) {
      const list = await metrics.getPodMetrics(namespace);
      return list.items.map((item) => ({
        pod: item.metadata.name,
        containers: item.containers.map((container) => ({
          name: container.name,
          cpu: container.usage.cpu,
          memory: container.usage.memory
        }))
      }));
    }
  };
}
