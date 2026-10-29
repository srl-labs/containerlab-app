// Management network settings tab: one card per network; the expanded card holds its form.
import React, { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

import { SettingsField } from "../../../settings/SettingsField";
import { useRuntimeLimit } from "../../../stores/labHostStore";
import { RuntimeLimitNote } from "../../ui/form";
import { DEFAULT_MGMT_NETWORK_NAME, getMgmtNetworks } from "../../../core/types/labSettings";
import { getMgmtNetworkColor } from "../../../core/utilities/mgmtNetworks";
import type { MgmtNetworkListActions } from "../../../hooks/editor/useLabSettings";

import { MgmtNetworkForm } from "./MgmtNetworkForm";
import { TailscaleStatusSection } from "./TailscaleStatusSection";
import { useMgmtNetworkUsage, type MgmtNetworkUsage } from "./mgmtNetworkUsage";
import type {
  DriverOptionsActions,
  LabSettings,
  MgmtFormState,
  MgmtNetworkFormState,
  MgmtSettingsSetters,
  MgmtSettingsState
} from "./types";

interface MgmtTabProps {
  mgmt: MgmtSettingsState;
  setMgmt: MgmtSettingsSetters;
  driverOpts: DriverOptionsActions;
  isViewMode: boolean;
  networks: MgmtNetworkListActions;
  /** Settings the form was loaded from, to match nodes to renamed networks */
  labSettings?: LabSettings;
}

function displayName(network: MgmtNetworkFormState): string {
  return network.networkName.trim() || DEFAULT_MGMT_NETWORK_NAME;
}

function describeSubnet(network: MgmtNetworkFormState): string | undefined {
  if (network.ipv4Type === "auto" || network.ipv6Type === "auto") return "auto subnet";
  const subnets = [network.ipv4Subnet, network.ipv6Subnet].filter((subnet) => subnet !== "");
  return subnets.length > 0 ? subnets.join(", ") : undefined;
}

function describeDriver(network: MgmtNetworkFormState): string | undefined {
  if (network.driver !== "macvlan") return undefined;
  const parent = network.macvlanParent.trim();
  return parent !== "" ? `macvlan on ${parent}` : "macvlan";
}

function describeNetwork(network: MgmtNetworkFormState, nodeCount: number): string {
  const details = [
    describeDriver(network),
    describeSubnet(network),
    network.tailscaleMode !== "off" ? "Tailscale" : undefined,
    nodeCount === 1 ? "1 node" : `${nodeCount} nodes`
  ];
  return details.filter((detail) => detail !== undefined && detail !== "").join(" · ");
}

function listNodes(nodes: string[]): string {
  const shown = nodes.slice(0, 6).join(", ");
  return nodes.length > 6 ? `${shown} and ${nodes.length - 6} more` : shown;
}

/** One network as a card; the expanded card holds the form for that network. */
const NetworkCard: React.FC<{
  network: MgmtNetworkFormState;
  index: number;
  count: number;
  nodeCount: number;
  isExpanded: boolean;
  hasIssues: boolean;
  isViewMode: boolean;
  actions: MgmtNetworkListActions;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ network, index, count, nodeCount, isExpanded, hasIssues, isViewMode, actions, onToggle, children }) => {
  const name = displayName(network);
  const bodyId = `lab-settings-mgmt-network-${network.id}-form`;
  return (
    <Box
      sx={{
        border: 1,
        borderColor: isExpanded ? "primary.main" : "divider",
        borderRadius: 1,
        overflow: "hidden"
      }}
    >
      <Box
        data-testid={`lab-settings-mgmt-network-${index}`}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          pl: 1,
          pr: 0.5,
          py: 0.5,
          "&:hover": { bgcolor: "action.hover" }
        }}
      >
        <Box
          component="button"
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          aria-controls={bodyId}
          aria-label={`Edit management network ${name}`}
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 1.25,
            p: 0.5,
            border: 0,
            bgcolor: "transparent",
            color: "inherit",
            font: "inherit",
            textAlign: "left",
            cursor: "pointer"
          }}
        >
          <ExpandMoreIcon
            fontSize="small"
            sx={{
              color: "text.secondary",
              transform: isExpanded ? "none" : "rotate(-90deg)",
              transition: "transform 120ms ease",
              "@media (prefers-reduced-motion: reduce)": { transition: "none" }
            }}
          />
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              flexShrink: 0,
              bgcolor: getMgmtNetworkColor(index)
            }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
              {name}
              {index === 0 && count > 1 ? (
                <Typography component="span" variant="caption" sx={{ color: "text.secondary", ml: 1 }}>
                  default
                </Typography>
              ) : null}
            </Typography>
            <Typography
              variant="caption"
              sx={{ color: hasIssues ? "error.main" : "text.secondary", display: "block" }}
              noWrap
            >
              {hasIssues ? "Needs attention" : describeNetwork(network, nodeCount)}
            </Typography>
          </Box>
        </Box>
        {count > 1 && !isViewMode ? (
          <Tooltip title="Remove">
            <IconButton
              size="small"
              aria-label={`Remove ${name}`}
              onClick={() => actions.remove(index)}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : null}
      </Box>
      {isExpanded ? (
        <Box
          id={bodyId}
          sx={{ display: "grid", rowGap: 2, p: 2, borderTop: 1, borderColor: "divider" }}
        >
          {children}
        </Box>
      ) : null}
    </Box>
  );
};

const NetworkList: React.FC<{
  actions: MgmtNetworkListActions;
  usage: MgmtNetworkUsage;
  isViewMode: boolean;
  renderForm: () => React.ReactNode;
}> = ({ actions, usage, isViewMode, renderForm }) => {
  // The selected network stays bound to the form while its card is collapsed.
  const [collapsed, setCollapsed] = useState(false);
  // c9s: a lab has one management network.
  const networksLimit = useRuntimeLimit("mgmtNetworks");
  const toggle = (index: number) => {
    if (index === actions.selected) {
      setCollapsed((value) => !value);
      return;
    }
    actions.select(index);
    setCollapsed(false);
  };
  return (
    <SettingsField
      title="Networks"
      wide
    >
      <Box data-testid="lab-settings-mgmt-networks" sx={{ display: "grid", gap: 1 }}>
        {actions.networks.map((network, index) => (
          <NetworkCard
            key={network.id}
            network={network}
            index={index}
            count={actions.networks.length}
            nodeCount={usage.counts[index] ?? 0}
            isExpanded={index === actions.selected && !collapsed}
            onToggle={() => toggle(index)}
            hasIssues={Object.keys(actions.issues[index] ?? {}).length > 0}
            isViewMode={isViewMode}
            actions={actions}
          >
            {index === actions.selected && !collapsed ? renderForm() : null}
          </NetworkCard>
        ))}
      </Box>
      {!isViewMode ? (
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.5 }}>
          <Tooltip title={networksLimit?.reason ?? ""}>
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddIcon />}
                disabled={networksLimit !== undefined}
                onClick={() => {
                  actions.add();
                  setCollapsed(false);
                }}
                data-testid="lab-settings-mgmt-add-network"
              >
                Add network
              </Button>
            </span>
          </Tooltip>
          {networksLimit ? <RuntimeLimitNote limit={networksLimit} /> : null}
        </Box>
      ) : null}
    </SettingsField>
  );
};

const DefaultNetworkField: React.FC<{ actions: MgmtNetworkListActions; isViewMode: boolean }> = ({
  actions,
  isViewMode
}) => {
  const names = actions.networks.map(displayName);
  const current = actions.defaultMgmtNet;
  const options = current !== "" && !names.includes(current) ? [...names, current] : names;
  return (
    <SettingsField
      title="Default management network"
      description="Network for nodes that do not pick one (topology.defaults.mgmt-net)."
    >
      <TextField
        slotProps={{ select: { inputProps: { "aria-label": "Default management network" } } }}
        id="lab-mgmt-default-net"
        select
        size="small"
        value={current}
        onChange={(event) => actions.setDefaultMgmtNet(event.target.value)}
        disabled={isViewMode}
        error={current !== "" && !names.includes(current)}
        helperText={current !== "" && !names.includes(current) ? "Not a network of this lab" : undefined}
      >
        <MenuItem value="">
          <em>None (each node picks one)</em>
        </MenuItem>
        {options.map((name) => (
          <MenuItem key={name} value={name}>
            {name}
          </MenuItem>
        ))}
      </TextField>
    </SettingsField>
  );
};

const UsageWarnings: React.FC<{ usage: MgmtNetworkUsage; several: boolean }> = ({
  usage,
  several
}) => (
  <>
    {several && usage.unassigned.length > 0 ? (
      <Alert severity="warning" variant="outlined" data-testid="lab-settings-mgmt-unassigned">
        {usage.unassigned.length === 1 ? "1 node has" : `${usage.unassigned.length} nodes have`} no
        management network: {listNodes(usage.unassigned)}. Pick a default management network or set the
        network in each node.
      </Alert>
    ) : null}
    {usage.unknown.length > 0 ? (
      <Alert severity="warning" variant="outlined" data-testid="lab-settings-mgmt-unknown">
        Nodes use networks this lab does not define:{" "}
        {listNodes(usage.unknown.map(({ node, network }) => `${node} (${network})`))}.
      </Alert>
    ) : null}
  </>
);

export const MgmtTab: React.FC<MgmtTabProps> = ({
  mgmt,
  setMgmt,
  driverOpts,
  isViewMode,
  networks,
  labSettings
}) => {
  const form = useMemo<MgmtFormState>(
    () => ({ networks: networks.networks, defaultMgmtNet: networks.defaultMgmtNet }),
    [networks.networks, networks.defaultMgmtNet]
  );
  const usage = useMgmtNetworkUsage(labSettings, form);
  const several = networks.networks.length > 1;
  // The running lab was deployed from the file, so the saved settings decide.
  const joinsTailscale = getMgmtNetworks(labSettings).some(
    (network) => network.tailscale !== undefined
  );
  return (
    <>
      <NetworkList
        actions={networks}
        usage={usage}
        isViewMode={isViewMode}
        renderForm={() => (
          <MgmtNetworkForm
            key={networks.networks[networks.selected]?.id}
            mgmt={mgmt}
            setMgmt={setMgmt}
            driverOpts={driverOpts}
            isViewMode={isViewMode}
            isDefaultNetwork={networks.selected === 0}
            issues={networks.issues[networks.selected] ?? {}}
          />
        )}
      />
      {several || networks.defaultMgmtNet !== "" ? (
        <DefaultNetworkField actions={networks} isViewMode={isViewMode} />
      ) : null}
      <UsageWarnings usage={usage} several={several} />
      {joinsTailscale ? <TailscaleStatusSection /> : null}
    </>
  );
};
