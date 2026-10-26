/**
 * Streams the CPU and memory usage of the viewer's deployed lab from its lab
 * backend and posts each sample to the webview as `node-stats-update`.
 */
import { MSG_NODE_STATS_UPDATE } from "@containerlab/clab-ui/session";
import { errorStatus } from "@srl-labs/containerlab-lab-backend";

import { resolveLab } from "../../../backend/labBackends";

import { formatErrorMessage, log } from "./logger";

const STATS_INTERVAL_SECONDS = 2;
const RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];
const UNAVAILABLE =
  "This lab host does not report node CPU and memory usage. Update clab-api-server to see it.";

export interface NodeStatsFeedTarget {
  /** Topology file of the lab, a local path or a lab-host URI. */
  yamlPath: string;
  labName: string;
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export class NodeStatsFeed {
  private key = "";
  private controller: AbortController | undefined;
  private readonly post: (message: unknown) => void;

  constructor(post: (message: unknown) => void) {
    this.post = post;
  }

  /** Follows `target`, or stops when it is undefined. */
  update(target: NodeStatsFeedTarget | undefined): void {
    const key = target ? `${target.yamlPath}|${target.labName}` : "";
    if (key === this.key) return;
    this.key = key;
    this.controller?.abort();
    this.controller = undefined;
    this.send({ clear: true });
    if (!target?.labName) return;
    this.controller = new AbortController();
    void this.run(target, this.controller.signal);
  }

  dispose(): void {
    this.controller?.abort();
    this.controller = undefined;
    this.key = "";
  }

  private send(data: Record<string, unknown>): void {
    this.post({ type: MSG_NODE_STATS_UPDATE, data });
  }

  private async run(target: NodeStatsFeedTarget, signal: AbortSignal): Promise<void> {
    for (let attempt = 0; !signal.aborted; attempt += 1) {
      try {
        const { backend } = await resolveLab(target.yamlPath, target.labName);
        if (!(await backend.features()).nodeStats) {
          this.send({ unavailable: UNAVAILABLE });
          return;
        }
        const samples = await backend.streamLabStats(target.labName, {
          intervalSeconds: STATS_INTERVAL_SECONDS,
          signal
        });
        for await (const sample of samples) {
          attempt = 0;
          this.send({ sample });
        }
      } catch (error) {
        if (signal.aborted) return;
        if (errorStatus(error) === 501) {
          this.send({ unavailable: UNAVAILABLE });
          return;
        }
        log.debug(`Node stats stream for ${target.labName} failed: ${formatErrorMessage(error)}`);
      }
      await wait(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)], signal);
    }
  }
}
