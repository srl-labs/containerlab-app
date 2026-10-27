// Where the nodes of a lab on a c9s lab host run, as `containerlab inspect` reports it.
import { isRecord } from "../core/utilities/typeHelpers";

/** A node port that clabernetes exposes. */
export interface LabNodeExposedPort {
  /** The Service port, on the load balancer address. */
  exposePort: number;
  /** The port on the node. */
  destinationPort: number;
  protocol: "TCP" | "UDP";
}

/** Where one node of a c9s lab runs. Docker and Podman nodes have none of it. */
export interface LabNodeLocation {
  node: string;
  containerName: string;
  namespace: string;
  pod: string;
  /** The primary device container of the pod. */
  container: string;
  exposedPorts: LabNodeExposedPort[];
  loadBalancerAddress?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function ports(value: unknown): LabNodeExposedPort[] {
  if (!Array.isArray(value)) return [];
  const result: LabNodeExposedPort[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const exposePort = Number(entry.exposePort ?? entry.expose_port);
    const destinationPort = Number(entry.destinationPort ?? entry.destination_port ?? exposePort);
    if (!Number.isInteger(exposePort) || !Number.isInteger(destinationPort)) continue;
    result.push({ exposePort, destinationPort, protocol: text(entry.protocol).toUpperCase() === "UDP" ? "UDP" : "TCP" });
  }
  return result;
}

/**
 * The node locations in a lab's inspect records. Records without a pod
 * (Docker, Podman) are left out, so the list is empty off c9s.
 */
export function parseNodeLocations(value: unknown): LabNodeLocation[] {
  if (!Array.isArray(value)) return [];
  const locations: LabNodeLocation[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const pod = text(entry.pod);
    const namespace = text(entry.namespace);
    if (!pod || !namespace) continue;
    const containerName = text(entry.name);
    const lab = text(entry.lab_name) || text(entry.labName);
    const node =
      text(entry.nodeName) ||
      text(entry.node_name) ||
      (lab && containerName.startsWith(`${lab}-`) ? containerName.slice(lab.length + 1) : containerName);
    const loadBalancerAddress = text(entry.load_balancer_address) || text(entry.loadBalancerAddress);
    locations.push({
      node,
      containerName,
      namespace,
      pod,
      container: text(entry.container),
      exposedPorts: ports(entry.exposed_ports ?? entry.exposedPorts),
      ...(loadBalancerAddress ? { loadBalancerAddress } : {})
    });
  }
  return locations.sort((left, right) => left.node.localeCompare(right.node));
}

function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:=@%+,-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * The kubectl command that opens a shell in a c9s node's device container,
 * e.g. `kubectl --context lab-prod -n c9s-demo exec -it demo-n1-… -c node-n1-… -- sh`,
 * with `--kubeconfig` when the lab host names its kubeconfig file.
 */
export function kubectlExecCommand(
  location: Pick<LabNodeLocation, "namespace" | "pod" | "container">,
  options: { kubeContext?: string; kubeconfig?: string; shell?: string } = {}
): string {
  const words = [
    "kubectl",
    ...(options.kubeconfig ? ["--kubeconfig", options.kubeconfig] : []),
    ...(options.kubeContext ? ["--context", options.kubeContext] : []),
    "-n",
    location.namespace,
    "exec",
    "-it",
    location.pod,
    ...(location.container ? ["-c", location.container] : []),
    "--",
    ...(options.shell ?? "sh").split(/\s+/).filter(Boolean)
  ];
  return words.map(shellWord).join(" ");
}
