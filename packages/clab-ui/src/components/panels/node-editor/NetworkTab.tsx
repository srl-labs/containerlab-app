// Network tab for node editor.
import React, { useMemo } from "react";
import Box from "@mui/material/Box";

import {
  InputField,
  SelectField,
  DynamicList,
  FilterableDropdown,
  PanelAddSection,
  PanelSection
} from "../../ui/form";
import { useGraphStore } from "../../../stores/graphStore";
import { useTopoViewerStore } from "../../../stores/topoViewerStore";
import { CONTAINER_NETWORK_MODE_PREFIX } from "../../../core/utilities/nodeEditorConversions";
import { getMgmtNetworkName, getMgmtNetworks } from "../../../core/types/labSettings";
import type { MgmtSettings } from "../../../core/types/labSettings";
import {
  MGMT_NET_KEY,
  getMgmtNetworkColor,
  getMgmtNetworkSubnet,
  isAddressInSubnet,
  isMgmtNetExempt,
  resolveNodeMgmtNetwork
} from "../../../core/utilities/mgmtNetworks";

import type { TabProps } from "./types";
import { withCurrentOption } from "./selectOptions";

const CONTAINER_MODE = "container";

// Default is the lab management network; "container" picks the target below
const NETWORK_MODE_OPTIONS = [
  { value: "", label: "Default" },
  { value: "host", label: "Host" },
  { value: "none", label: "None" },
  { value: CONTAINER_MODE, label: "Container" }
];

/** Mode shown in the select for a network-mode value */
function getNetworkModeSelection(networkMode: string): string {
  if (networkMode === CONTAINER_MODE || networkMode.startsWith(CONTAINER_NETWORK_MODE_PREFIX)) {
    return CONTAINER_MODE;
  }
  return networkMode;
}

/** Container whose network namespace a `container:<name>` mode shares */
function getContainerTarget(networkMode: string): string {
  return networkMode.startsWith(CONTAINER_NETWORK_MODE_PREFIX)
    ? networkMode.slice(CONTAINER_NETWORK_MODE_PREFIX.length)
    : "";
}

/** Other topology nodes the node can share a network namespace with */
function useContainerTargetOptions(nodeId: string): Array<{ value: string; label: string }> {
  const nodes = useGraphStore((state) => state.nodes);
  return useMemo(
    () =>
      nodes
        .filter((node) => node.type === "topology-node" && node.id !== nodeId)
        .map((node) => ({ value: node.id, label: node.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [nodes, nodeId]
  );
}

const NetworkModeFields: React.FC<TabProps> = ({ data, onChange }) => {
  const networkMode = data.networkMode ?? "";
  const selection = getNetworkModeSelection(networkMode);
  const target = getContainerTarget(networkMode);
  const targetOptions = useContainerTargetOptions(data.id);

  const handleModeChange = (value: string) => {
    if (value === CONTAINER_MODE) {
      if (selection !== CONTAINER_MODE) onChange({ networkMode: CONTAINER_NETWORK_MODE_PREFIX });
      return;
    }
    onChange({ networkMode: value });
  };

  return (
    <>
      <SelectField
        id="node-network-mode"
        label="Network Mode"
        value={selection}
        onChange={handleModeChange}
        options={withCurrentOption(NETWORK_MODE_OPTIONS, selection)}
      />
      {selection === CONTAINER_MODE && (
        <FilterableDropdown
          id="node-network-mode-container"
          label="Container"
          value={target}
          onChange={(value) =>
            onChange({ networkMode: `${CONTAINER_NETWORK_MODE_PREFIX}${value.trim()}` })
          }
          options={targetOptions}
          placeholder="Node name or external container"
          allowFreeText
          required
          helperText={
            target === ""
              ? "Pick a node or type an external container name"
              : "Shares the network namespace of this container"
          }
        />
      )}
    </>
  );
};

const INHERITANCE_LABELS: Record<string, string> = {
  defaults: "topology defaults",
  kind: "kind settings",
  group: "group settings"
};

function describeInheritance(data: TabProps["data"], inheritedProps: string[]): string | undefined {
  if (!inheritedProps.includes(MGMT_NET_KEY)) return undefined;
  const level = data.inheritedFrom?.[MGMT_NET_KEY];
  return `Inherited from ${level !== undefined ? (INHERITANCE_LABELS[level] ?? level) : "defaults"}`;
}

function useMgmtNetworks(): MgmtSettings[] {
  const labSettings = useTopoViewerStore((state) => state.labSettings);
  return useMemo(() => getMgmtNetworks(labSettings), [labSettings]);
}

function DotIcon({ color }: { color: string }) {
  return (
    <Box
      component="span"
      sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: color, display: "inline-block" }}
    />
  );
}

/** Problem or note shown under the management network select */
function describeMgmtNet(
  data: TabProps["data"],
  networks: MgmtSettings[],
  inheritedProps: string[]
): { text?: string; error: boolean } {
  if (isMgmtNetExempt(undefined, data.networkMode)) {
    return { text: "Ignored: the node uses a network mode", error: false };
  }
  const resolved = resolveNodeMgmtNetwork(data.mgmtNet, networks, { kind: data.kind });
  if (resolved.status === "exempt") {
    return { text: `Not used by ${data.kind ?? ""} nodes`, error: false };
  }
  if (resolved.status === "missing") {
    return { text: "Required: this lab has several management networks", error: true };
  }
  if (resolved.status === "unknown") {
    return { text: `${resolved.name} is not a management network of this lab`, error: true };
  }
  if (networks.length > 1 && data.runtime === "podman") {
    return { text: "Several management networks need the Docker runtime", error: true };
  }
  return { text: describeInheritance(data, inheritedProps), error: false };
}

/** `mgmt-net` picker; shown when the lab has several networks or the node sets one */
const MgmtNetworkField: React.FC<TabProps> = ({ data, onChange, inheritedProps = [] }) => {
  const networks = useMgmtNetworks();
  const value = data.mgmtNet ?? "";
  const options = useMemo(() => {
    const names = networks.length > 0 ? networks.map(getMgmtNetworkName) : [getMgmtNetworkName({})];
    return withCurrentOption(
      [
        { value: "", label: "Not set" },
        ...names.map((name, index) => ({
          value: name,
          label: index === 0 ? `${name} (default)` : name,
          icon: <DotIcon color={getMgmtNetworkColor(index)} />
        }))
      ],
      value
    );
  }, [networks, value]);
  if (data.isCustomTemplate === true || (networks.length < 2 && value === "")) return null;
  const note = describeMgmtNet(data, networks, inheritedProps);

  return (
    <SelectField
      id="node-mgmt-net"
      label="Management Network"
      value={value}
      onChange={(next) => onChange({ mgmtNet: next })}
      options={options}
      disabled={isMgmtNetExempt(undefined, data.networkMode)}
      error={note.error}
      helperText={note.text}
    />
  );
};

/** Warning when a static address lies outside the subnet of the node's network */
function useAddressWarning(
  data: TabProps["data"],
  address: string | undefined,
  family: "ipv4" | "ipv6"
): string | undefined {
  const networks = useMgmtNetworks();
  if (address === undefined || address.trim() === "") return undefined;
  const resolved = resolveNodeMgmtNetwork(data.mgmtNet, networks, {
    kind: data.kind,
    networkMode: data.networkMode
  });
  if (resolved.status !== "ok") return undefined;
  const subnet = getMgmtNetworkSubnet(networks[resolved.index], resolved.index === 0, family);
  if (subnet === undefined || isAddressInSubnet(address, subnet) !== false) return undefined;
  return `Outside ${resolved.name} (${subnet})`;
}

export const NetworkTab: React.FC<TabProps> = (props) => {
  const { data, onChange } = props;
  const ipv4Warning = useAddressWarning(data, data.mgmtIpv4, "ipv4");
  const ipv6Warning = useAddressWarning(data, data.mgmtIpv6, "ipv6");

  const handleAddPort = () => {
    onChange({ ports: [...(data.ports ?? []), ""] });
  };

  const handleAddDns = () => {
    onChange({ dnsServers: [...(data.dnsServers ?? []), ""] });
  };

  const handleAddDnsSearch = () => {
    onChange({ dnsSearch: [...(data.dnsSearch ?? []), ""] });
  };

  const handleAddDnsOption = () => {
    onChange({ dnsOptions: [...(data.dnsOptions ?? []), ""] });
  };

  const handleAddAlias = () => {
    onChange({ aliases: [...(data.aliases ?? []), ""] });
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <PanelSection title="Management Network">
        <MgmtNetworkField {...props} />
        <InputField
          id="node-mgmt-ipv4"
          label="Management IPv4"
          value={data.mgmtIpv4 ?? ""}
          onChange={(value) => onChange({ mgmtIpv4: value })}
          placeholder="e.g., 172.20.20.100"
          error={ipv4Warning !== undefined}
          helperText={ipv4Warning}
        />
        <InputField
          id="node-mgmt-ipv6"
          label="Management IPv6"
          value={data.mgmtIpv6 ?? ""}
          onChange={(value) => onChange({ mgmtIpv6: value })}
          placeholder="e.g., 2001:db8::100"
          error={ipv6Warning !== undefined}
          helperText={ipv6Warning}
        />
        <NetworkModeFields {...props} />
      </PanelSection>

      <PanelAddSection title="Port Mappings" onAdd={handleAddPort}>
        <DynamicList
          items={data.ports ?? []}
          onChange={(items) => onChange({ ports: items })}
          placeholder="host:container[/protocol]"
          hideAddButton
        />
      </PanelAddSection>

      <PanelAddSection title="DNS Servers" onAdd={handleAddDns}>
        <DynamicList
          items={data.dnsServers ?? []}
          onChange={(items) => onChange({ dnsServers: items })}
          placeholder="DNS server address"
          hideAddButton
        />
      </PanelAddSection>

      <PanelAddSection title="DNS Search Domains" onAdd={handleAddDnsSearch}>
        <DynamicList
          items={data.dnsSearch ?? []}
          onChange={(items) => onChange({ dnsSearch: items })}
          placeholder="e.g., example.com"
          hideAddButton
        />
      </PanelAddSection>

      <PanelAddSection title="DNS Options" onAdd={handleAddDnsOption}>
        <DynamicList
          items={data.dnsOptions ?? []}
          onChange={(items) => onChange({ dnsOptions: items })}
          placeholder="e.g., ndots:2"
          hideAddButton
        />
      </PanelAddSection>

      <PanelAddSection title="Network Aliases" onAdd={handleAddAlias}>
        <DynamicList
          items={data.aliases ?? []}
          onChange={(items) => onChange({ aliases: items })}
          placeholder="Alias name"
          hideAddButton
        />
      </PanelAddSection>
    </Box>
  );
};
