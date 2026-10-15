// Dot on a node showing which management network it joins, when the lab has several.
import React, { useMemo } from "react";

import { getMgmtNetworks } from "../../../core/types/labSettings";
import {
  MGMT_NET_KEY,
  MGMT_NETWORK_MISSING_COLOR,
  getMgmtNetworkColor,
  resolveNodeMgmtNetwork
} from "../../../core/utilities/mgmtNetworks";
import { useTopoViewerStore } from "../../../stores/topoViewerStore";

const BADGE_STYLE_BASE: React.CSSProperties = {
  position: "absolute",
  left: -3,
  top: -3,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 10,
  height: 10,
  borderRadius: 999,
  border: "1px solid rgba(15, 23, 42, 0.45)",
  boxSizing: "border-box",
  color: "#FFFFFF",
  fontSize: 8,
  fontWeight: 700,
  lineHeight: 1,
  zIndex: 4
};

const PROBLEM_STYLE: React.CSSProperties = {
  ...BADGE_STYLE_BASE,
  width: 12,
  height: 12,
  left: -4,
  top: -4,
  backgroundColor: MGMT_NETWORK_MISSING_COLOR
};

export function NodeMgmtNetworkBadge({ extraData }: { extraData?: Record<string, unknown> }) {
  const labSettings = useTopoViewerStore((state) => state.labSettings);
  const mode = useTopoViewerStore((state) => state.mgmtNetworkBadge);
  const networks = useMemo(() => getMgmtNetworks(labSettings), [labSettings]);
  if (networks.length < 2) return null;

  const resolved = resolveNodeMgmtNetwork(extraData?.[MGMT_NET_KEY], networks, {
    kind: extraData?.kind,
    networkMode: extraData?.["network-mode"]
  });
  if (resolved.status === "exempt") return null;
  if (resolved.status === "ok") {
    return (
      <div
        className={`topology-node-mgmt-badge${mode === "hover" ? " on-hover" : ""}`}
        data-mgmt-net={resolved.name}
        title={`Management network: ${resolved.name}`}
        style={{ ...BADGE_STYLE_BASE, backgroundColor: getMgmtNetworkColor(resolved.index) }}
      />
    );
  }
  const title =
    resolved.status === "missing"
      ? "No management network: pick one in the node's Network tab"
      : `Management network ${resolved.name} is not defined in this lab`;
  return (
    <div className="topology-node-mgmt-badge problem" title={title} style={PROBLEM_STYLE}>
      !
    </div>
  );
}
