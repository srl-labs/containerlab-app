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
import { CONTAINER_NETWORK_MODE_PREFIX } from "../../../core/utilities/nodeEditorConversions";

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

export const NetworkTab: React.FC<TabProps> = (props) => {
  const { data, onChange } = props;

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
        <InputField
          id="node-mgmt-ipv4"
          label="Management IPv4"
          value={data.mgmtIpv4 ?? ""}
          onChange={(value) => onChange({ mgmtIpv4: value })}
          placeholder="e.g., 172.20.20.100"
        />
        <InputField
          id="node-mgmt-ipv6"
          label="Management IPv6"
          value={data.mgmtIpv6 ?? ""}
          onChange={(value) => onChange({ mgmtIpv6: value })}
          placeholder="e.g., 2001:db8::100"
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
