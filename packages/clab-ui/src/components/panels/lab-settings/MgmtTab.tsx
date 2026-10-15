// Management network settings tab: the list of networks and the form of the selected one.
import React, { useMemo } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";

import { SettingsField } from "../../../settings/SettingsField";
import { DEFAULT_MGMT_NETWORK_NAME } from "../../../core/types/labSettings";
import { getMgmtNetworkColor } from "../../../core/utilities/mgmtNetworks";
import type { MgmtNetworkListActions } from "../../../hooks/editor/useLabSettings";

import { MgmtNetworkForm } from "./MgmtNetworkForm";
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
    nodeCount === 1 ? "1 node" : `${nodeCount} nodes`
  ];
  return details.filter((detail) => detail !== undefined && detail !== "").join(" · ");
}

function listNodes(nodes: string[]): string {
  const shown = nodes.slice(0, 6).join(", ");
  return nodes.length > 6 ? `${shown} and ${nodes.length - 6} more` : shown;
}

const NetworkRow: React.FC<{
  network: MgmtNetworkFormState;
  index: number;
  count: number;
  nodeCount: number;
  isSelected: boolean;
  hasIssues: boolean;
  isViewMode: boolean;
  actions: MgmtNetworkListActions;
}> = ({ network, index, count, nodeCount, isSelected, hasIssues, isViewMode, actions }) => {
  const name = displayName(network);
  return (
    <Box
      data-testid={`lab-settings-mgmt-network-${index}`}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        pl: 1.5,
        pr: 0.5,
        py: 0.5,
        borderTop: index > 0 ? 1 : 0,
        borderColor: "divider",
        bgcolor: isSelected ? "action.selected" : undefined
      }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => actions.select(index)}
        aria-pressed={isSelected}
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
        <Box sx={{ display: "flex", flexShrink: 0 }}>
          <Tooltip title="Move up">
            <span>
              <IconButton
                size="small"
                aria-label={`Move ${name} up`}
                disabled={index === 0}
                onClick={() => actions.move(index, -1)}
              >
                <ArrowUpwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Move down">
            <span>
              <IconButton
                size="small"
                aria-label={`Move ${name} down`}
                disabled={index === count - 1}
                onClick={() => actions.move(index, 1)}
              >
                <ArrowDownwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Remove">
            <IconButton
              size="small"
              aria-label={`Remove ${name}`}
              onClick={() => actions.remove(index)}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ) : null}
    </Box>
  );
};

const NetworkList: React.FC<{
  actions: MgmtNetworkListActions;
  usage: MgmtNetworkUsage;
  isViewMode: boolean;
}> = ({ actions, usage, isViewMode }) => (
  <SettingsField
    title="Networks"
    description={
      actions.networks.length > 1
        ? "Nodes join a network with mgmt-net. The first network is the default, used for tools containers. Docker runtime only."
        : "Add a network to put nodes on separate management networks (Docker runtime only)."
    }
    wide
  >
    <Box
      data-testid="lab-settings-mgmt-networks"
      sx={{ border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden" }}
    >
      {actions.networks.map((network, index) => (
        <NetworkRow
          key={network.id}
          network={network}
          index={index}
          count={actions.networks.length}
          nodeCount={usage.counts[index] ?? 0}
          isSelected={index === actions.selected}
          hasIssues={Object.keys(actions.issues[index] ?? {}).length > 0}
          isViewMode={isViewMode}
          actions={actions}
        />
      ))}
    </Box>
    {!isViewMode ? (
      <Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={actions.add}
          data-testid="lab-settings-mgmt-add-network"
        >
          Add network
        </Button>
      </Box>
    ) : null}
  </SettingsField>
);

const DefaultNetworkField: React.FC<{ actions: MgmtNetworkListActions; isViewMode: boolean }> = ({
  actions,
  isViewMode
}) => {
  const names = actions.networks.map(displayName);
  const current = actions.defaultMgmtNet;
  const options = current !== "" && !names.includes(current) ? [...names, current] : names;
  return (
    <SettingsField
      title="Default for Nodes"
      description="Network for nodes that do not pick one (topology.defaults.mgmt-net)."
    >
      <TextField
        slotProps={{ select: { inputProps: { "aria-label": "Default for Nodes" } } }}
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
        management network: {listNodes(usage.unassigned)}. Pick a default for nodes or set the
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
  const selectedName = displayName(networks.networks[networks.selected]);
  return (
    <>
      <NetworkList actions={networks} usage={usage} isViewMode={isViewMode} />
      {several || networks.defaultMgmtNet !== "" ? (
        <DefaultNetworkField actions={networks} isViewMode={isViewMode} />
      ) : null}
      <UsageWarnings usage={usage} several={several} />
      {several ? (
        <Typography
          component="h3"
          variant="subtitle2"
          data-testid="lab-settings-mgmt-selected-title"
          sx={{ pt: 1, borderTop: 1, borderColor: "divider" }}
        >
          Network {selectedName}
        </Typography>
      ) : null}
      <MgmtNetworkForm
        key={networks.networks[networks.selected]?.id}
        mgmt={mgmt}
        setMgmt={setMgmt}
        driverOpts={driverOpts}
        isViewMode={isViewMode}
        isDefaultNetwork={networks.selected === 0}
        issues={networks.issues[networks.selected] ?? {}}
      />
    </>
  );
};
