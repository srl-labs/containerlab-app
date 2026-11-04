import type Docker from "dockerode";

import type { InspectAllLabsResponse, InspectContainerInfo } from "../contract/dto.ts";

/** Port as `containerlab inspect` reports it. */
interface ClabPort {
  host_ip?: string;
  host_port?: number;
  port?: number;
  protocol?: string;
}

/** The JSON clab-api-server returns for one lab container. */
export interface ClabContainerRecord {
  name: string;
  container_id: string;
  image: string;
  kind: string;
  state: string;
  status: string;
  ipv4_address: string;
  ipv6_address: string;
  lab_name: string;
  nodeName: string;
  labPath: string;
  absLabPath: string;
  group: string;
  owner: string;
  mgmt_network?: string;
  ports?: ClabPort[];
}

function address(ip: string | undefined, prefixLength: number | undefined): string {
  return ip ? `${ip}/${prefixLength ?? 0}` : "N/A";
}

function containerName(container: Docker.ContainerInfo): string {
  return (container.Names[0] ?? container.Id).replace(/^\//, "");
}

/** Maps a runtime container of a lab to clab-api-server's inspect record. */
function toClabContainerRecord(container: Docker.ContainerInfo): ClabContainerRecord {
  const labels = container.Labels;
  const networkName = container.HostConfig?.NetworkMode;
  const networks = container.NetworkSettings?.Networks ?? {};
  const network =
    (networkName ? networks[networkName] : undefined) ?? Object.values(networks)[0];
  const ports = (container.Ports ?? [])
    .filter((port) => port.PublicPort)
    .map((port) => ({
      host_ip: port.IP,
      host_port: port.PublicPort,
      port: port.PrivatePort,
      protocol: port.Type
    }));
  const labPath = labels["clab-topo-file"] ?? "";
  return {
    name: containerName(container),
    container_id: container.Id.slice(0, 12),
    image: container.Image,
    kind: labels["clab-node-kind"] ?? "",
    state: container.State,
    status: container.Status,
    ipv4_address: address(network?.IPAddress, network?.IPPrefixLen),
    ipv6_address: address(network?.GlobalIPv6Address, network?.GlobalIPv6PrefixLen),
    lab_name: labels.containerlab ?? "",
    nodeName: labels["clab-node-name"] ?? "",
    labPath,
    absLabPath: labPath,
    group: labels["clab-node-group"] ?? "",
    owner: labels["clab-owner"] ?? "",
    ...(networkName && networkName !== "default" ? { mgmt_network: networkName } : {}),
    ...(ports.length > 0 ? { ports } : {})
  };
}

/** Lists lab containers, grouped by lab name, without containerlab's internal helpers. */
export async function inspectLabs(docker: Docker, labName?: string): Promise<InspectAllLabsResponse> {
  const containers = await docker.listContainers({
    all: true,
    filters: { label: [labName ? `containerlab=${labName}` : "containerlab"] }
  });
  const labs: Record<string, ClabContainerRecord[]> = {};
  for (const container of containers) {
    if (container.Labels["clab-internal-node"] === "true") continue;
    const record = toClabContainerRecord(container);
    if (!record.lab_name) continue;
    (labs[record.lab_name] ??= []).push(record);
  }
  for (const records of Object.values(labs)) {
    records.sort((left, right) => left.name.localeCompare(right.name));
  }
  // The wire format is snake_case; the declared type predates that.
  return labs as unknown as InspectAllLabsResponse;
}

/** Reads a string field of an inspect record in either spelling. */
export function inspectField(container: InspectContainerInfo, ...keys: string[]): string {
  const record = container as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
