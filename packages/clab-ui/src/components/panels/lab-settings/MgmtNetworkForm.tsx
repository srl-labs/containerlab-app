// Form of one management network: driver, addressing, driver-specific options and Tailscale.
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
  MgmtSettingsState,
  TailscaleMode
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
      description="Bridge uses a Linux bridge on the host. Macvlan puts nodes on the Layer 2 network of a host interface."
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
          title="Parent interface"
          description="Host interface the nodes attach to. For a VLAN, create its interface first, for example eth1.100."
        >
          <TextField
            slotProps={{ htmlInput: { "aria-label": "Parent interface" } }}
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
          title="Macvlan mode"
          description="Bridge mode lets nodes on the same parent reach each other and is the only mode with host access."
        >
          <TextField
            slotProps={{ select: { inputProps: { "aria-label": "Macvlan mode" } } }}
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
            title="Host access"
            description="Adds a macvlan interface on the host so it can reach the nodes. Without it, Linux blocks traffic between a parent and its macvlan interfaces."
          >
            <Switch
              size="small"
              checked={mgmt.macvlanAux}
              onChange={(event) => setMgmt.setMacvlanAux(event.target.checked)}
              disabled={isViewMode}
              slotProps={{ input: { "aria-label": "Host access" } }}
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
        <SettingsField title="IPv4 subnet CIDR" description="Custom IPv4 subnet, for example 172.100.100.0/24.">
          <TextField
            slotProps={{ htmlInput: { "aria-label": "IPv4 subnet CIDR" } }}
            id="lab-mgmt-ipv4-subnet"
            size="small"
            placeholder="e.g., 172.100.100.0/24"
            value={mgmt.ipv4Subnet}
            onChange={(event) => setMgmt.setIpv4Subnet(event.target.value)}
            disabled={isViewMode}
          />
        </SettingsField>
        <SettingsField title="IPv4 gateway" description="Gateway of the custom IPv4 subnet.">
          <TextField
            slotProps={{ htmlInput: { "aria-label": "IPv4 gateway" } }}
            id="lab-mgmt-ipv4-gateway"
            size="small"
            placeholder="e.g., 172.100.100.1"
            value={mgmt.ipv4Gateway}
            onChange={(event) => setMgmt.setIpv4Gateway(event.target.value)}
            disabled={isViewMode}
          />
        </SettingsField>
        <SettingsField title="IPv4 range" description="Optional allocation range within the subnet.">
          <TextField
            slotProps={{ htmlInput: { "aria-label": "IPv4 range" } }}
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
        <SettingsField title="IPv6 subnet CIDR" description="Custom IPv6 subnet, for example 3fff:172:100:100::/80.">
          <TextField
            slotProps={{ htmlInput: { "aria-label": "IPv6 subnet CIDR" } }}
            id="lab-mgmt-ipv6-subnet"
            size="small"
            placeholder="e.g., 3fff:172:100:100::/80"
            value={mgmt.ipv6Subnet}
            onChange={(event) => setMgmt.setIpv6Subnet(event.target.value)}
            disabled={isViewMode}
          />
        </SettingsField>
        <SettingsField title="IPv6 gateway" description="Gateway of the custom IPv6 subnet.">
          <TextField
            slotProps={{ htmlInput: { "aria-label": "IPv6 gateway" } }}
            id="lab-mgmt-ipv6-gateway"
            size="small"
            placeholder="e.g., 3fff:172:100:100::1"
            value={mgmt.ipv6Gateway}
            onChange={(event) => setMgmt.setIpv6Gateway(event.target.value)}
            disabled={isViewMode}
          />
        </SettingsField>
        <SettingsField title="IPv6 range" description="Optional allocation range within the subnet.">
          <TextField
            slotProps={{ htmlInput: { "aria-label": "IPv6 range" } }}
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
    <SettingsField title="Bridge name" description="Linux bridge name (default: br-<network-id>).">
      <TextField
        slotProps={{ htmlInput: { "aria-label": "Bridge name" } }}
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
    <SettingsField title="Enable external access" description="Allow access from outside the lab.">
      <Switch
        size="small"
        checked={mgmt.externalAccess}
        onChange={(event) => setMgmt.setExternalAccess(event.target.checked)}
        disabled={isViewMode}
        slotProps={{ input: { "aria-label": "Enable external access" } }}
      />
    </SettingsField>
  </>
);

const AllocationFields: React.FC<FieldProps> = ({ mgmt, setMgmt, isViewMode }) => (
  <>
    <SettingsField
      title="Address allocation"
      description="Who assigns node addresses (ipam.provider). Containerlab keeps them stable across redeploys."
    >
      <TextField
        slotProps={{ select: { inputProps: { "aria-label": "Address allocation" } } }}
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
        title="Duplicate address detection"
        description={
          mgmt.driver === "macvlan"
            ? "Check that an address is free before using it, with ARP and neighbour solicitation on the parent interface. Slows very large labs."
            : "Check that an address is free before using it."
        }
      >
        <Switch
          size="small"
          checked={mgmt.ipamDad}
          onChange={(event) => setMgmt.setIpamDad(event.target.checked)}
          disabled={isViewMode}
          slotProps={{ input: { "aria-label": "Duplicate address detection" } }}
        />
      </SettingsField>
    ) : null}
    <SettingsField
      title="Skip when unused"
      description="Do not create the network when no node uses it: every node on it runs with network-mode: none, or none picks it."
    >
      <Switch
        size="small"
        checked={mgmt.skipWhenUnused}
        onChange={(event) => setMgmt.setSkipWhenUnused(event.target.checked)}
        disabled={isViewMode}
        slotProps={{ input: { "aria-label": "Skip when unused" } }}
      />
    </SettingsField>
  </>
);

const TAILSCALE_MODE_LABELS: Record<TailscaleMode, string> = {
  off: "Off (default)",
  sidecar: "Sidecar per node (auth key)",
  proxy: "Lab proxy (SSO login)"
};

const TailscaleFields: React.FC<FieldProps> = ({ mgmt, setMgmt, isViewMode, issues }) => (
  <>
    <SettingsField
      title="Tailscale"
      description="Join the network to a Tailscale tailnet. With sidecars every node is a device of its own; the lab proxy is one device that forwards the node ports marked /ts."
    >
      <TextField
        slotProps={{ select: { inputProps: { "aria-label": "Tailscale" } } }}
        id="lab-mgmt-tailscale"
        select
        size="small"
        value={mgmt.tailscaleMode}
        onChange={(event) => setMgmt.setTailscaleMode(event.target.value as TailscaleMode)}
        disabled={isViewMode}
        error={issues.tailscale !== undefined}
        helperText={issues.tailscale}
      >
        {Object.entries(TAILSCALE_MODE_LABELS).map(([mode, label]) => (
          <MenuItem key={mode} value={mode}>
            {label}
          </MenuItem>
        ))}
      </TextField>
    </SettingsField>
    {mgmt.tailscaleMode === "sidecar" ? (
      <SettingsField
        title="Auth key"
        description="Reusable, ideally ephemeral key from the Tailscale admin console. Reference an environment variable such as ${TS_AUTHKEY} to keep the key out of the file."
      >
        <TextField
          slotProps={{ htmlInput: { "aria-label": "Auth key" } }}
          id="lab-mgmt-tailscale-auth-key"
          size="small"
          placeholder="${TS_AUTHKEY}"
          value={mgmt.tailscaleAuthKey}
          onChange={(event) => setMgmt.setTailscaleAuthKey(event.target.value)}
          disabled={isViewMode}
          error={issues.tailscaleAuthKey !== undefined}
          helperText={issues.tailscaleAuthKey}
        />
      </SettingsField>
    ) : null}
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
      <SettingsField title="Network name" description="Docker network name (default: clab).">
        <TextField
          slotProps={{ htmlInput: { "aria-label": "Network name" } }}
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
      <TailscaleFields {...fieldProps} />
      <SettingsField
        title="Driver options"
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
