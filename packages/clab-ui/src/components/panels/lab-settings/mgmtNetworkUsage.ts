/**
 * Which nodes use each management network in the Lab Settings draft, so the
 * Management tab can show counts and nodes that would fail to deploy.
 */
import { useMemo } from "react";

import { useGraphStore } from "../../../stores/graphStore";
import { getMgmtNetworks } from "../../../core/types/labSettings";
import { INHERITED_FROM_KEY } from "../../../core/parsing/NodeConfigResolver";
import { MGMT_NET_KEY, resolveNodeMgmtNetwork } from "../../../core/utilities/mgmtNetworks";
import { isRecord } from "../../../core/utilities/typeHelpers";

import type { LabSettings, MgmtFormState } from "./types";

export interface MgmtNodeRef {
  id: string;
  kind?: unknown;
  networkMode?: unknown;
  /** Effective `mgmt-net` of the node */
  mgmtNet?: unknown;
  /** True when that value comes from `topology.defaults` */
  fromDefaults: boolean;
}

export interface MgmtNetworkUsage {
  /** Nodes per network, in form order */
  counts: number[];
  /** Nodes that would have no network */
  unassigned: string[];
  /** Nodes that name a network the draft does not define */
  unknown: Array<{ node: string; network: string }>;
}

export function summarizeMgmtNetworkUsage(
  nodes: MgmtNodeRef[],
  loadedNames: string[],
  form: MgmtFormState
): MgmtNetworkUsage {
  const renames = new Map<string, string>();
  for (const network of form.networks) {
    const oldName = network.source !== undefined ? loadedNames[network.source] : undefined;
    if (oldName !== undefined && oldName !== "") renames.set(oldName, network.networkName.trim());
  }
  const networks = form.networks.map((network) => ({ network: network.networkName.trim() }));
  const usage: MgmtNetworkUsage = {
    counts: form.networks.map(() => 0),
    unassigned: [],
    unknown: []
  };

  for (const node of nodes) {
    const own = node.fromDefaults || typeof node.mgmtNet !== "string" ? "" : node.mgmtNet;
    const mgmtNet = own !== "" ? (renames.get(own) ?? own) : form.defaultMgmtNet;
    const resolved = resolveNodeMgmtNetwork(mgmtNet, networks, {
      kind: node.kind,
      networkMode: node.networkMode
    });
    if (resolved.status === "ok") usage.counts[resolved.index] += 1;
    else if (resolved.status === "missing") usage.unassigned.push(node.id);
    else if (resolved.status === "unknown") {
      usage.unknown.push({ node: node.id, network: resolved.name });
    }
  }
  return usage;
}

export function useMgmtNetworkUsage(
  labSettings: LabSettings | undefined,
  form: MgmtFormState
): MgmtNetworkUsage {
  const nodes = useGraphStore((state) => state.nodes);
  const refs = useMemo(
    () =>
      nodes.flatMap((node): MgmtNodeRef[] => {
        if (node.type !== "topology-node") return [];
        const extra: unknown = node.data.extraData;
        if (!isRecord(extra)) return [{ id: node.id, fromDefaults: false }];
        const inheritedFrom = extra[INHERITED_FROM_KEY];
        return [
          {
            id: node.id,
            kind: extra.kind,
            networkMode: extra["network-mode"],
            mgmtNet: extra[MGMT_NET_KEY],
            fromDefaults: isRecord(inheritedFrom) && inheritedFrom[MGMT_NET_KEY] === "defaults"
          }
        ];
      }),
    [nodes]
  );
  const loadedNames = useMemo(
    () => getMgmtNetworks(labSettings).map((network) => network.network ?? ""),
    [labSettings]
  );
  return useMemo(
    () => summarizeMgmtNetworkUsage(refs, loadedNames, form),
    [refs, loadedNames, form]
  );
}
