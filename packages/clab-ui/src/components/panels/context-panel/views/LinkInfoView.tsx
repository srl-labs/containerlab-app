// Link info view with endpoint tabs.
import React, { useState } from "react";
import Box from "@mui/material/Box";

import type { LinkData } from "../../../../hooks/ui";
import type { InterfaceStatsPayload } from "../../../../core/types/topology";
import { getString } from "../../../../core/utilities/typeHelpers";
import type { TabDefinition } from "../../../ui/editor";
import { TabNavigation } from "../../../ui/editor/TabNavigation";
import { PanelSectionHeader, ReadOnlyCopyField } from "../../../ui/form";

const LazyTrafficChart = React.lazy(async () => {
  const module = await import("../../TrafficChart");
  return { default: module.TrafficChart };
});

interface EndpointData {
  node?: string;
  interface?: string;
  mac?: string;
  mtu?: string | number;
  type?: string;
  stats?: InterfaceStatsPayload;
}

type LinkInfoData = LinkData & {
  endpointA?: EndpointData;
  endpointB?: EndpointData;
  extraData?: {
    clabSourceStats?: InterfaceStatsPayload;
    clabTargetStats?: InterfaceStatsPayload;
    clabSourceMacAddress?: string;
    clabTargetMacAddress?: string;
    clabSourceMtu?: string | number;
    clabTargetMtu?: string | number;
    clabSourceType?: string;
    clabTargetType?: string;
    [key: string]: unknown;
  };
};

export interface LinkInfoViewProps {
  linkData: LinkInfoData | null;
}

type EndpointTab = "a" | "b";

function toEndpointTab(id: string): EndpointTab {
  return id === "b" ? "b" : "a";
}

function buildFallbackEndpoint(options: {
  node: string;
  endpoint?: string;
  mac?: string;
  mtu?: string | number;
  type?: string;
  stats?: InterfaceStatsPayload;
}): EndpointData {
  return {
    node: options.node,
    interface: options.endpoint ?? "",
    mac: options.mac ?? "",
    mtu: options.mtu ?? "",
    type: options.type ?? "",
    stats: options.stats
  };
}

function mergeEndpointData(fallback: EndpointData, override?: EndpointData): EndpointData {
  return {
    ...fallback,
    ...override,
    stats: override?.stats ?? fallback.stats
  };
}

function getEndpoints(linkData: LinkInfoData): { a: EndpointData; b: EndpointData } {
  const extraData = linkData.extraData ?? {};
  const fallbackA = buildFallbackEndpoint({
    node: linkData.source,
    endpoint: linkData.sourceEndpoint,
    mac: getString(extraData.clabSourceMacAddress) ?? "",
    mtu: extraData.clabSourceMtu,
    type: getString(extraData.clabSourceType) ?? "",
    stats: extraData.clabSourceStats
  });
  const fallbackB = buildFallbackEndpoint({
    node: linkData.target,
    endpoint: linkData.targetEndpoint,
    mac: getString(extraData.clabTargetMacAddress) ?? "",
    mtu: extraData.clabTargetMtu,
    type: getString(extraData.clabTargetType) ?? "",
    stats: extraData.clabTargetStats
  });

  return {
    a: mergeEndpointData(fallbackA, linkData.endpointA),
    b: mergeEndpointData(fallbackB, linkData.endpointB)
  };
}

export const LinkInfoView: React.FC<LinkInfoViewProps> = ({ linkData }) => {
  const [activeTab, setActiveTab] = useState<EndpointTab>("a");

  if (!linkData) return null;

  const endpoints = getEndpoints(linkData);
  const currentEndpoint = activeTab === "a" ? endpoints.a : endpoints.b;
  const endpointKey = `${activeTab}:${currentEndpoint.node}:${currentEndpoint.interface}`;

  const endpointTabs: TabDefinition[] = [
    { id: "a", label: `${linkData.source}:${linkData.sourceEndpoint ?? "eth"}` },
    { id: "b", label: `${linkData.target}:${linkData.targetEndpoint ?? "eth"}` }
  ];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TabNavigation
        tabs={endpointTabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(toEndpointTab(id))}
      />

      <Box sx={{ flex: 1, overflow: "auto" }}>
        <PanelSectionHeader title="Endpoint" withTopDivider={true} />
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, p: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
            <ReadOnlyCopyField label="Node" value={currentEndpoint.node ?? ""} />
            <ReadOnlyCopyField label="Interface" value={currentEndpoint.interface ?? ""} />
          </Box>
          <ReadOnlyCopyField label="Type" value={currentEndpoint.type ?? ""} />
        </Box>

        <PanelSectionHeader title="Layer 2" withTopDivider={true} />
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, p: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
            <ReadOnlyCopyField label="MAC" value={currentEndpoint.mac ?? ""} mono />
            <ReadOnlyCopyField label="MTU" value={String(currentEndpoint.mtu ?? "")} />
          </Box>
        </Box>

        <PanelSectionHeader title="Traffic" withTopDivider={true} />
        <Box sx={{ minHeight: 200 }}>
          <React.Suspense fallback={null}>
            <LazyTrafficChart stats={currentEndpoint.stats} endpointKey={endpointKey} />
          </React.Suspense>
        </Box>
      </Box>
    </Box>
  );
};
