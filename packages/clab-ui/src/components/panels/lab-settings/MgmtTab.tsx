// Management network settings tab.
import React from "react";
import AddIcon from "@mui/icons-material/Add";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Typography from "@mui/material/Typography";

import { InputField, KeyValueList, SelectField, type SelectOption } from "../../ui/form";

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

type SectionProps = Omit<MgmtTabProps, "driverOpts">;

const IPV4_TYPE_OPTIONS: SelectOption[] = [
  { value: "default", label: "Default (172.20.20.0/24)" },
  { value: "auto", label: "Auto-assign" },
  { value: "custom", label: "Custom" }
];

const IPV6_TYPE_OPTIONS: SelectOption[] = [
  { value: "default", label: "Default (3fff:172:20:20::/64)" },
  { value: "auto", label: "Auto-assign" },
  { value: "custom", label: "Custom" }
];

/** IPv4 settings section */
const Ipv4Section: React.FC<SectionProps> = ({ mgmt, setMgmt, isViewMode }) => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
    <SelectField
      id="lab-mgmt-ipv4-type"
      label="IPv4 Subnet"
      value={mgmt.ipv4Type}
      onChange={(v) => setMgmt.setIpv4Type(v as IpType)}
      options={IPV4_TYPE_OPTIONS}
      disabled={isViewMode}
    />

    {mgmt.ipv4Type === "custom" && (
      <>
        <InputField
          id="lab-mgmt-ipv4-subnet"
          label="IPv4 Subnet"
          placeholder="e.g., 172.100.100.0/24"
          value={mgmt.ipv4Subnet}
          onChange={setMgmt.setIpv4Subnet}
          disabled={isViewMode}
        />
        <InputField
          id="lab-mgmt-ipv4-gateway"
          label="IPv4 Gateway"
          placeholder="e.g., 172.100.100.1"
          value={mgmt.ipv4Gateway}
          onChange={setMgmt.setIpv4Gateway}
          disabled={isViewMode}
        />
        <InputField
          id="lab-mgmt-ipv4-range"
          label="IPv4 Range"
          placeholder="e.g., 172.100.100.128/25"
          value={mgmt.ipv4Range}
          onChange={setMgmt.setIpv4Range}
          disabled={isViewMode}
        />
      </>
    )}
  </Box>
);

/** IPv6 settings section */
const Ipv6Section: React.FC<SectionProps> = ({ mgmt, setMgmt, isViewMode }) => (
  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
    <SelectField
      id="lab-mgmt-ipv6-type"
      label="IPv6 Subnet"
      value={mgmt.ipv6Type}
      onChange={(v) => setMgmt.setIpv6Type(v as IpType)}
      options={IPV6_TYPE_OPTIONS}
      disabled={isViewMode}
    />

    {mgmt.ipv6Type === "custom" && (
      <>
        <InputField
          id="lab-mgmt-ipv6-subnet"
          label="IPv6 Subnet"
          placeholder="e.g., 3fff:172:100:100::/80"
          value={mgmt.ipv6Subnet}
          onChange={setMgmt.setIpv6Subnet}
          disabled={isViewMode}
        />
        <InputField
          id="lab-mgmt-ipv6-gateway"
          label="IPv6 Gateway"
          placeholder="e.g., 3fff:172:100:100::1"
          value={mgmt.ipv6Gateway}
          onChange={setMgmt.setIpv6Gateway}
          disabled={isViewMode}
        />
      </>
    )}
  </Box>
);

/** Convert DriverOption[] to Record for KeyValueList */
function driverOptionsToRecord(options: DriverOption[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (const opt of options) {
    record[opt.key] = opt.value;
  }
  return record;
}

/** Convert Record back to DriverOption[] */
function recordToDriverOptions(record: Record<string, string>): DriverOption[] {
  return Object.entries(record).map(([key, value]) => ({ key, value }));
}

export const MgmtTab: React.FC<MgmtTabProps> = ({ mgmt, setMgmt, driverOpts, isViewMode }) => {
  const driverRecord = driverOptionsToRecord(mgmt.driverOptions);

  const handleDriverChange = (record: Record<string, string>) => {
    driverOpts.setAll(recordToDriverOptions(record));
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, p: 2 }}>
        {/* Network Name */}
        <InputField
          id="lab-mgmt-network-name"
          label="Network Name"
          placeholder="Docker network name (default: clab)"
          value={mgmt.networkName}
          onChange={setMgmt.setNetworkName}
          disabled={isViewMode}
        />

        <Ipv4Section mgmt={mgmt} setMgmt={setMgmt} isViewMode={isViewMode} />
        <Ipv6Section mgmt={mgmt} setMgmt={setMgmt} isViewMode={isViewMode} />

        {/* MTU */}
        <InputField
          id="lab-mgmt-mtu"
          label="MTU"
          type="number"
          min={0}
          step={1}
          placeholder="Defaults to docker0 interface MTU"
          value={mgmt.mtu}
          onChange={setMgmt.setMtu}
          disabled={isViewMode}
        />

        {/* Bridge Name */}
        <InputField
          id="lab-mgmt-bridge"
          label="Bridge Name"
          placeholder="Linux bridge name (default: br-<network-id>)"
          value={mgmt.bridge}
          onChange={setMgmt.setBridge}
          disabled={isViewMode}
        />

        {/* External Access */}
        <FormControlLabel
          control={
            <Checkbox
              checked={mgmt.externalAccess}
              onChange={(e) => setMgmt.setExternalAccess(e.target.checked)}
              disabled={isViewMode}
              size="small"
            />
          }
          label="Enable External Access"
        />
      </Box>

      {/* Bridge Driver Options */}
      <Divider />
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1
        }}
      >
        <Typography variant="subtitle2">Bridge Driver Options</Typography>
        {!isViewMode && (
          <Button size="small" startIcon={<AddIcon />} onClick={driverOpts.add} sx={{ py: 0 }}>
            ADD
          </Button>
        )}
      </Box>
      <Divider />
      <Box sx={{ p: 2 }}>
        <KeyValueList
          items={driverRecord}
          onChange={handleDriverChange}
          keyPlaceholder="Option key"
          valuePlaceholder="Option value"
          disabled={isViewMode}
          hideAddButton
        />
      </Box>
    </Box>
  );
};
