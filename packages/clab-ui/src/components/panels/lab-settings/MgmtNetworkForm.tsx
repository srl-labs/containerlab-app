// Form of one management network: driver, addressing and driver-specific options.
import React from "react";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { SettingsField } from "../../../settings/SettingsField";
import { KeyValueList } from "../../ui/form";
import type { MgmtNetworkIssues } from "../../../hooks/editor/labSettingsForm";

import type {
  DriverOption,
  DriverOptionsActions,
  IpamProvider,
  IpType,
  MacvlanMode,
  MgmtDriver,
  MgmtSettingsSetters,
  MgmtSettingsState
} from "./types";

interface MgmtNetworkFormProps {
  mgmt: MgmtSettingsState;
  setMgmt: MgmtSettingsSetters;
  driverOpts: DriverOptionsActions;
  isViewMode: boolean;
  /** The first network gets containerlab's default subnets */
  isDefaultNetwork: boolean;
  issues: MgmtNetworkIssues;
}

type FieldProps = Omit<MgmtNetworkFormProps, "driverOpts" | "isDefaultNetwork">;

function driverOptionsToRecord(options: DriverOption[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const opt of options) {
    record[opt.key] = opt.value;
  }
  return record;
}

function recordToDriverOptions(record: Record<string, string>): DriverOption[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

const MACVLAN_MODE_LABELS: Record<MacvlanMode, string> = {
  bridge: "Bridge (default)",
  private: "Private",
  vepa: "VEPA",
  passthru: "Passthru"
};

const DriverFields: React.FC<FieldProps> = ({ mgmt, setMgmt, isViewMode, issues }) => (
  <>
    <SettingsField
      title="Driver"
      description="Bridge connects nodes through a Linux bridge on the host. Macvlan puts them directly on the Layer 2 network of a host interface."
    >
      <TextField
        slotProps={{ select: { inputProps: { "aria-label": "Driver" } } }}
        id="lab-mgmt-driver"
        select
        size="small"
        value={mgmt.driver}
        onChange={(event) => setMgmt.setDriver(event.target.value as MgmtDriver)}
        disabled={isViewMode}
      >
        <MenuItem value="bridge">Bridge (default)</MenuItem>
        <MenuItem value="macvlan">Macvlan</MenuItem>
      </TextField>
    </SettingsField>
    {mgmt.driver === "macvlan" ? (
      <>
        <SettingsField
          title="Parent Interface"
          description="Existing host interface the nodes attach to. For a VLAN, create the VLAN interface first, for example eth1.100."
        >
          <TextField
            slotProps={{ htmlInput: { "aria-label": "Parent Interface" } }}
            id="lab-mgmt-macvlan-parent"
            size="small"
            placeholder="e.g., eth1"
            value={mgmt.macvlanParent}
            onChange={(event) => setMgmt.setMacvlanParent(event.target.value)}
            disabled={isViewMode}
            error={issues.macvlanParent !== undefined}
            helperText={issues.macvlanParent}
          />
        </SettingsField>
        <SettingsField
          title="Macvlan Mode"
          description="Bridge mode lets nodes on the same parent reach each other and is the only mode with host access."
        >
          <TextField
            slotProps={{ select: { inputProps: { "aria-label": "Macvlan Mode" } } }}
            id="lab-mgmt-macvlan-mode"
            select
            size="small"
            value={mgmt.macvlanMode}
            onChange={(event) => setMgmt.setMacvlanMode(event.target.value as MacvlanMode)}
            disabled={isViewMode}
          >
            {Object.entries(MACVLAN_MODE_LABELS).map(([mode, label]) => (
              <MenuItem key={mode} value={mode}>
                {label}
              </MenuItem>
            ))}
          </TextField>
        </SettingsField>
        {mgmt.macvlanMode === "bridge" ? (
          <SettingsField
            title="Host Access"
            description="Add a macvlan interface on the host so the host can reach the nodes. Linux blocks traffic between a parent and its macvlan interfaces otherwise."
          >
            <Switch
              size="small"
              checked={mgmt.macvlanAux}
              onChange={(event) => setMgmt.setMacvlanAux(event.target.checked)}
              disabled={isViewMode}
              slotProps={{ input: { "aria-label": "Host Access" } }}
            />
          </SettingsField>
        ) : null}
      </>
    ) : null}
  </>
);

/** Label of the subnet choice that leaves the subnet unset. */
function defaultSubnetLabel(
  driver: MgmtDriver,
  isDefaultNetwork: boolean,
  defaultSubnet: string
): string {
  if (driver === "macvlan") return "From parent interface";
  return isDefaultNetwork ? `Default (${defaultSubnet})` : "Default (picked by Docker)";
}

const SubnetTypeField: React.FC<{
  family: "IPv4" | "IPv6";
  value: IpType;
  onChange: (value: IpType) => void;
  driver: MgmtDriver;
  isDefaultNetwork: boolean;
  isViewMode: boolean;
  issue?: string;
}> = ({ family, value, onChange, driver, isDefaultNetwork, isViewMode, issue }) => {
  const title = `${family} Subnet`;
  const defaultSubnet = family === "IPv4" ? "172.20.20.0/24" : "3fff:172:20:20::/64";
  // Macvlan has no auto subnet; a file that sets one still shows it, flagged.
  const showAuto = driver === "bridge" || value === "auto";
  return (
    <SettingsField title={title} description={`Management ${family} addressing.`}>
      <TextField
        slotProps={{ select: { inputProps: { "aria-label": title } } }}
        id={`lab-mgmt-${family.toLowerCase()}-type`}
        select
        size="small"
        value={value}
        onChange={(event) => onChange(event.target.value as IpType)}
        disabled={isViewMode}
        error={issue !== undefined}
        helperText={issue}
      >
        <MenuItem value="default">{defaultSubnetLabel(driver, isDefaultNetwork, defaultSubnet)}</MenuItem>
        {showAuto ? <MenuItem value="auto">Auto-assign</MenuItem> : null}
        <MenuItem value="custom">Custom</MenuItem>
      </TextField>
    </SettingsField>
  );
};

const AddressFields: React.FC<FieldProps & { isDefaultNetwork: boolean }> = ({
  mgmt,
  setMgmt,
  isViewMode,
  isDefaultNetwork,
  issues
}) => (
  <>
    <SubnetTypeField
      family="IPv4"
      value={mgmt.ipv4Type}
      onChange={setMgmt.setIpv4Type}
      driver={mgmt.driver}
      isDefaultNetwork={isDefaultNetwork}
      isViewMode={isViewMode}
      issue={issues.ipv4Type}
    />
    {mgmt.ipv4Type === "custom" ? (
      <>
        <SettingsField title="IPv4 Subnet CIDR" description="Custom IPv4 subnet, for example 172.100.100.0/24.">
          <TextField
            slotProps={{ htmlInput: { "aria-label": "IPv4 Subnet CIDR" } }}
            id="lab-mgmt-ipv4-subnet"
            size="small"
            placeholder="e.g., 172.100.100.0/24"
            value={mgmt.ipv4Subnet}
            onChange={(event) => setMgmt.setIpv4Subnet(event.target.value)}
            disabled={isViewMode}
          />
        </SettingsField>
        <SettingsField title="IPv4 Gateway" description="Gateway address for the custom IPv4 subnet.">
          <TextField
            slotProps={{ htmlInput: { "aria-label": "IPv4 Gateway" } }}
            id="lab-mgmt-ipv4-gateway"
            size="small"
            placeholder="e.g., 172.100.100.1"
            value={mgmt.ipv4Gateway}
            onChange={(event) => setMgmt.setIpv4Gateway(event.target.value)}
            disabled={isViewMode}
          />
        </SettingsField>
        <SettingsField title="IPv4 Range" description="Optional allocation range within the subnet.">
          <TextField
            slotProps={{ htmlInput: { "aria-label": "IPv4 Range" } }}
            id="lab-mgmt-ipv4-range"
            size="small"
            placeholder="e.g., 172.100.100.128/25"
            value={mgmt.ipv4Range}
            onChange={(event) => setMgmt.setIpv4Range(event.target.value)}
            disabled={isViewMode}
          />
        </SettingsField>
      </>
    ) : null}
    <SubnetTypeField
      family="IPv6"
      value={mgmt.ipv6Type}
      onChange={setMgmt.setIpv6Type}
      driver={mgmt.driver}
      isDefaultNetwork={isDefaultNetwork}
      isViewMode={isViewMode}
      issue={issues.ipv6Type}
    />
    {mgmt.ipv6Type === "custom" ? (
      <>
        <SettingsField title="IPv6 Subnet CIDR" description="Custom IPv6 subnet, for example 3fff:172:100:100::/80.">
          <TextField
            slotProps={{ htmlInput: { "aria-label": "IPv6 Subnet CIDR" } }}
            id="lab-mgmt-ipv6-subnet"
            size="small"
            placeholder="e.g., 3fff:172:100:100::/80"
            value={mgmt.ipv6Subnet}
            onChange={(event) => setMgmt.setIpv6Subnet(event.target.value)}
            disabled={isViewMode}
          />
        </SettingsField>
        <SettingsField title="IPv6 Gateway" description="Gateway address for the custom IPv6 subnet.">
          <TextField
            slotProps={{ htmlInput: { "aria-label": "IPv6 Gateway" } }}
            id="lab-mgmt-ipv6-gateway"
            size="small"
            placeholder="e.g., 3fff:172:100:100::1"
            value={mgmt.ipv6Gateway}
            onChange={(event) => setMgmt.setIpv6Gateway(event.target.value)}
            disabled={isViewMode}
          />
        </SettingsField>
        <SettingsField title="IPv6 Range" description="Optional allocation range within the subnet.">
          <TextField
            slotProps={{ htmlInput: { "aria-label": "IPv6 Range" } }}
            id="lab-mgmt-ipv6-range"
            size="small"
            placeholder="e.g., 3fff:172:100:100::8000/81"
            value={mgmt.ipv6Range}
            onChange={(event) => setMgmt.setIpv6Range(event.target.value)}
            disabled={isViewMode}
          />
        </SettingsField>
      </>
    ) : null}
  </>
);

/** Settings containerlab only accepts on bridge networks. */
const BridgeFields: React.FC<FieldProps> = ({ mgmt, setMgmt, isViewMode, issues }) => (
  <>
    <SettingsField title="MTU" description="Defaults to the docker0 interface MTU.">
      <TextField
        slotProps={{ htmlInput: { "aria-label": "MTU" } }}
        id="lab-mgmt-mtu"
        size="small"
        type="number"
        placeholder="Defaults to docker0 interface MTU"
        value={mgmt.mtu}
        onChange={(event) => setMgmt.setMtu(event.target.value)}
        disabled={isViewMode}
      />
    </SettingsField>
    <SettingsField title="Bridge Name" description="Linux bridge name (default: br-<network-id>).">
      <TextField
        slotProps={{ htmlInput: { "aria-label": "Bridge Name" } }}
        id="lab-mgmt-bridge"
        size="small"
        placeholder="Linux bridge name"
        value={mgmt.bridge}
        onChange={(event) => setMgmt.setBridge(event.target.value)}
        disabled={isViewMode}
        error={issues.bridge !== undefined}
        helperText={issues.bridge}
      />
    </SettingsField>
    <SettingsField title="Enable External Access" description="Allow access to the management network from outside the lab.">
      <Switch
        size="small"
        checked={mgmt.externalAccess}
        onChange={(event) => setMgmt.setExternalAccess(event.target.checked)}
        disabled={isViewMode}
        slotProps={{ input: { "aria-label": "Enable External Access" } }}
      />
    </SettingsField>
  </>
);

const AllocationFields: React.FC<FieldProps> = ({ mgmt, setMgmt, isViewMode }) => (
  <>
    <SettingsField
      title="Address Allocation"
      description="Who assigns node addresses (ipam.provider). Containerlab keeps them stable across redeploys."
    >
      <TextField
        slotProps={{ select: { inputProps: { "aria-label": "Address Allocation" } } }}
        id="lab-mgmt-ipam-provider"
        select
        size="small"
        value={mgmt.ipamProvider}
        onChange={(event) => setMgmt.setIpamProvider(event.target.value as IpamProvider)}
        disabled={isViewMode}
      >
        <MenuItem value="containerlab">Containerlab (default)</MenuItem>
        <MenuItem value="runtime">Container runtime</MenuItem>
      </TextField>
    </SettingsField>
    {mgmt.ipamProvider === "containerlab" ? (
      <SettingsField
        title="Duplicate Address Detection"
        description={
          mgmt.driver === "macvlan"
            ? "Check that an address is free before using it, with ARP and neighbour solicitations on the parent interface. Slows down very large labs."
            : "Check that an address is free before using it."
        }
      >
        <Switch
          size="small"
          checked={mgmt.ipamDad}
          onChange={(event) => setMgmt.setIpamDad(event.target.checked)}
          disabled={isViewMode}
          slotProps={{ input: { "aria-label": "Duplicate Address Detection" } }}
        />
      </SettingsField>
    ) : null}
    <SettingsField
      title="Skip When Unused"
      description="Do not create the network when no node uses it: every node on it runs with network-mode: none, or none picks it."
    >
      <Switch
        size="small"
        checked={mgmt.skipWhenUnused}
        onChange={(event) => setMgmt.setSkipWhenUnused(event.target.checked)}
        disabled={isViewMode}
        slotProps={{ input: { "aria-label": "Skip When Unused" } }}
      />
    </SettingsField>
  </>
);

export const MgmtNetworkForm: React.FC<MgmtNetworkFormProps> = ({
  mgmt,
  setMgmt,
  driverOpts,
  isViewMode,
  isDefaultNetwork,
  issues
}) => {
  const fieldProps: FieldProps = { mgmt, setMgmt, isViewMode, issues };
  return (
    <>
      <SettingsField title="Network Name" description="Docker network name (default: clab).">
        <TextField
          slotProps={{ htmlInput: { "aria-label": "Network Name" } }}
          id="lab-mgmt-network-name"
          size="small"
          placeholder="Docker network name (default: clab)"
          value={mgmt.networkName}
          onChange={(event) => setMgmt.setNetworkName(event.target.value)}
          disabled={isViewMode}
          error={issues.networkName !== undefined}
          helperText={issues.networkName}
        />
      </SettingsField>
      <DriverFields {...fieldProps} />
      <AddressFields {...fieldProps} isDefaultNetwork={isDefaultNetwork} />
      {mgmt.driver === "bridge" ? <BridgeFields {...fieldProps} /> : null}
      <AllocationFields {...fieldProps} />
      <SettingsField
        title="Driver Options"
        description={`Key/value options passed to the Docker ${mgmt.driver} driver.`}
        wide
        feedback={
          issues.driverOptions !== undefined ? (
            <Typography variant="caption" sx={{ color: "error.main" }}>
              {issues.driverOptions}
            </Typography>
          ) : undefined
        }
      >
        <KeyValueList
          items={driverOptionsToRecord(mgmt.driverOptions)}
          onChange={(record) => driverOpts.setAll(recordToDriverOptions(record))}
          keyPlaceholder="Option key"
          valuePlaceholder="Option value"
          disabled={isViewMode}
        />
      </SettingsField>
    </>
  );
};
