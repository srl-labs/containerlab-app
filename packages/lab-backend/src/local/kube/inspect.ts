import type { InspectAllLabsResponse } from "../../contract/dto.ts";
import { LabBackendError } from "../../contract/errors.ts";
import type { ClabContainerRecord } from "../inspect.ts";
import type { ResolvedLocalOptions } from "../options.ts";
import { containerlabCommand, lastContainerlabError, runCommand, stripAnsi } from "../process.ts";

/** A node port that clabernetes exposes (`Node.status.exposedPorts`). */
interface C9sExposedPort {
  /** The Service port, reachable on the load balancer address. */
  exposePort: number;
  /** The port on the node itself. */
  destinationPort: number;
  protocol: "TCP" | "UDP";
}

/** An inspect record of a c9s node: the Docker fields plus where the node runs. */
export interface C9sContainerRecord extends ClabContainerRecord {
  namespace: string;
  pod: string;
  /** The primary device container of the pod. */
  container: string;
  node_uid: string;
  exposed_ports: C9sExposedPort[];
  load_balancer_address: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function port(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number > 0 && number <= 65535 ? number : undefined;
}

function exposedPorts(value: unknown): C9sExposedPort[] {
  // Node.status.exposedPorts as clabernetes writes it, or only its port list.
  const list =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as { ports?: unknown }).ports
      : value;
  if (!Array.isArray(list)) return [];
  const ports: C9sExposedPort[] = [];
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const exposePort = port(record.exposePort ?? record.expose_port);
    const destinationPort = port(record.destinationPort ?? record.destination_port) ?? exposePort;
    if (exposePort === undefined || destinationPort === undefined) continue;
    const protocol = text(record.protocol).toUpperCase() === "UDP" ? "UDP" : "TCP";
    ports.push({ exposePort, destinationPort, protocol });
  }
  return ports;
}

/**
 * A `containerlab inspect -r c9s -f json` record in the shape every backend
 * returns, keeping where the node runs. The pod and container come from
 * containerlab; nothing here works them out.
 */
export function toC9sContainerRecord(raw: Record<string, unknown>, labName: string): C9sContainerRecord {
  const lab = text(raw.lab_name) || text(raw.labName) || labName;
  const name = text(raw.name);
  const nodeName =
    text(raw.node_name) || text(raw.nodeName) || (lab && name.startsWith(`${lab}-`) ? name.slice(lab.length + 1) : name);
  const labPath = text(raw.labPath) || text(raw.lab_path);
  const loadBalancer = text(raw.load_balancer_address) || text(raw.loadBalancerAddress);
  const exposed = exposedPorts(raw.exposed_ports ?? raw.exposedPorts);
  return {
    name,
    container_id: text(raw.container_id) || text(raw.containerId),
    image: text(raw.image),
    kind: text(raw.kind),
    state: text(raw.state),
    status: text(raw.status) || text(raw.state),
    ipv4_address: text(raw.ipv4_address) || "N/A",
    ipv6_address: text(raw.ipv6_address) || "N/A",
    lab_name: lab,
    nodeName,
    labPath,
    absLabPath: text(raw.absLabPath) || text(raw.abs_lab_path) || labPath,
    group: text(raw.group),
    owner: text(raw.owner),
    namespace: text(raw.namespace),
    pod: text(raw.pod),
    container: text(raw.container),
    node_uid: text(raw.node_uid) || text(raw.nodeUID),
    exposed_ports: exposed,
    load_balancer_address: loadBalancer
  };
}

/** `containerlab inspect -f json` output (`{ "<lab>": [record, ...] }`) as inspect records. */
export function parseC9sInspect(stdout: string): InspectAllLabsResponse {
  const start = stdout.indexOf("{");
  if (start < 0) return {};
  const parsed = JSON.parse(stdout.slice(start)) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const labs: Record<string, C9sContainerRecord[]> = {};
  for (const [labName, records] of Object.entries(parsed)) {
    if (!Array.isArray(records)) continue;
    const nodes = records
      .filter((record): record is Record<string, unknown> => typeof record === "object" && record !== null)
      .map((record) => toC9sContainerRecord(record, labName))
      .filter((record) => record.name !== "");
    if (nodes.length === 0) continue;
    labs[labName] = nodes.sort((left, right) => left.name.localeCompare(right.name));
  }
  // The wire format is snake_case; the declared type predates that.
  return labs as unknown as InspectAllLabsResponse;
}

/** containerlab's words when there is nothing to inspect. */
const NO_LABS = /no (containers|labs|nodes|topologies) found|not found/i;

/** Every c9s lab the user may see (`containerlab inspect -r c9s --all`), or one of them. */
export async function inspectC9sLabs(
  options: Pick<ResolvedLocalOptions, "binaryPath" | "sudo" | "env">,
  labName?: string
): Promise<InspectAllLabsResponse> {
  const [file, args] = containerlabCommand(options, ["inspect", "-r", "c9s", "--all", "--format", "json"]);
  const result = await runCommand(file, args, { env: options.env, timeoutMs: 60_000 });
  const stderr = stripAnsi(result.stderr);
  if (result.code !== 0) {
    if (NO_LABS.test(stderr)) return {};
    throw new LabBackendError(
      `containerlab inspect -r c9s failed: ${lastContainerlabError(stderr) ?? (stderr.trim() || `exit status ${result.code}`)}`,
      502
    );
  }
  const labs = parseC9sInspect(result.stdout);
  if (labName === undefined) return labs;
  return labs[labName] ? { [labName]: labs[labName] } : {};
}
