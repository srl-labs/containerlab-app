// Management network settings tab.
import React from "react";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";

import { SettingsField } from "../../../settings/SettingsField";
import { KeyValueList } from "../../ui/form";

import type {
  DriverOption,
  DriverOptionsActions,
  IpType,
  MgmtSettingsSetters,
  MgmtSettingsState
} from "./types";

interface MgmtTabProps {
  mgmt: MgmtSettingsState;
  setMgmt: MgmtSettingsSetters;
  driverOpts: DriverOptionsActions;
  isViewMode: boolean;
}

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

export const MgmtTab: React.FC<MgmtTabProps> = ({ mgmt, setMgmt, driverOpts, isViewMode }) => (
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
        sx={{ minWidth: 220 }}
      />
    </SettingsField>
    <SettingsField title="IPv4 Subnet" description="Management IPv4 addressing.">
      <TextField
        slotProps={{ select: { inputProps: { "aria-label": "IPv4 Subnet" } } }}
        id="lab-mgmt-ipv4-type"
        select
        size="small"
        value={mgmt.ipv4Type}
        onChange={(event) => setMgmt.setIpv4Type(event.target.value as IpType)}
        disabled={isViewMode}
        sx={{ minWidth: 220 }}
      >
        <MenuItem value="default">Default (172.20.20.0/24)</MenuItem>
        <MenuItem value="auto">Auto-assign</MenuItem>
        <MenuItem value="custom">Custom</MenuItem>
      </TextField>
    </SettingsField>
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
            sx={{ minWidth: 220 }}
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
            sx={{ minWidth: 220 }}
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
            sx={{ minWidth: 220 }}
          />
        </SettingsField>
      </>
    ) : null}
    <SettingsField title="IPv6 Subnet" description="Management IPv6 addressing.">
      <TextField
        slotProps={{ select: { inputProps: { "aria-label": "IPv6 Subnet" } } }}
        id="lab-mgmt-ipv6-type"
        select
        size="small"
        value={mgmt.ipv6Type}
        onChange={(event) => setMgmt.setIpv6Type(event.target.value as IpType)}
        disabled={isViewMode}
        sx={{ minWidth: 220 }}
      >
        <MenuItem value="default">Default (3fff:172:20:20::/64)</MenuItem>
        <MenuItem value="auto">Auto-assign</MenuItem>
        <MenuItem value="custom">Custom</MenuItem>
      </TextField>
    </SettingsField>
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
            sx={{ minWidth: 220 }}
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
            sx={{ minWidth: 220 }}
          />
        </SettingsField>
      </>
    ) : null}
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
        sx={{ minWidth: 160 }}
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
        sx={{ minWidth: 220 }}
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
    <SettingsField
      title="Bridge Driver Options"
      description="Key/value options passed to the Docker bridge driver."
      wide
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
