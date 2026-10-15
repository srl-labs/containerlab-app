/**
 * Hook for managing Lab Settings state (host-authoritative).
 */
import { useState, useCallback, useEffect } from "react";

import type {
  LabSettings,
  PrefixType,
  IpType,
  DriverOption,
  BasicSettingsState,
  MgmtSettingsState
} from "../../components/panels/lab-settings/types";
import { useTopologySessionClient } from "../../host";
import { executeTopologyCommand } from "../../services";

import { buildInitialBasic, buildInitialMgmt, buildLabSettingsUpdate } from "./labSettingsForm";

export interface UseLabSettingsStateResult {
  basic: BasicSettingsState;
  mgmt: MgmtSettingsState;
  setBasic: {
    setLabName: (v: string) => void;
    setPrefixType: (v: PrefixType) => void;
    setCustomPrefix: (v: string) => void;
  };
  setMgmt: {
    setNetworkName: (v: string) => void;
    setIpv4Type: (v: IpType) => void;
    setIpv4Subnet: (v: string) => void;
    setIpv4Gateway: (v: string) => void;
    setIpv4Range: (v: string) => void;
    setIpv6Type: (v: IpType) => void;
    setIpv6Subnet: (v: string) => void;
    setIpv6Gateway: (v: string) => void;
    setMtu: (v: string) => void;
    setBridge: (v: string) => void;
    setExternalAccess: (v: boolean) => void;
  };
  driverOpts: {
    add: () => void;
    remove: (index: number) => void;
    update: (index: number, field: "key" | "value", value: string) => void;
    setAll: (options: DriverOption[]) => void;
  };
  handleSave: () => Promise<void>;
}

export function useLabSettingsState(labSettings?: LabSettings): UseLabSettingsStateResult {
  const sessionClient = useTopologySessionClient();
  const [basic, setBasicState] = useState<BasicSettingsState>(() => buildInitialBasic(labSettings));
  const [mgmt, setMgmtState] = useState<MgmtSettingsState>(() => buildInitialMgmt(labSettings));

  useEffect(() => {
    setBasicState(buildInitialBasic(labSettings));
    setMgmtState(buildInitialMgmt(labSettings));
  }, [labSettings]);

  const setBasic = {
    setLabName: (v: string) => setBasicState((prev) => ({ ...prev, labName: v })),
    setPrefixType: (v: PrefixType) => setBasicState((prev) => ({ ...prev, prefixType: v })),
    setCustomPrefix: (v: string) => setBasicState((prev) => ({ ...prev, customPrefix: v }))
  };

  const setMgmt = {
    setNetworkName: (v: string) => setMgmtState((prev) => ({ ...prev, networkName: v })),
    setIpv4Type: (v: IpType) => setMgmtState((prev) => ({ ...prev, ipv4Type: v })),
    setIpv4Subnet: (v: string) => setMgmtState((prev) => ({ ...prev, ipv4Subnet: v })),
    setIpv4Gateway: (v: string) => setMgmtState((prev) => ({ ...prev, ipv4Gateway: v })),
    setIpv4Range: (v: string) => setMgmtState((prev) => ({ ...prev, ipv4Range: v })),
    setIpv6Type: (v: IpType) => setMgmtState((prev) => ({ ...prev, ipv6Type: v })),
    setIpv6Subnet: (v: string) => setMgmtState((prev) => ({ ...prev, ipv6Subnet: v })),
    setIpv6Gateway: (v: string) => setMgmtState((prev) => ({ ...prev, ipv6Gateway: v })),
    setMtu: (v: string) => setMgmtState((prev) => ({ ...prev, mtu: v })),
    setBridge: (v: string) => setMgmtState((prev) => ({ ...prev, bridge: v })),
    setExternalAccess: (v: boolean) => setMgmtState((prev) => ({ ...prev, externalAccess: v }))
  };

  const driverOpts = {
    add: () =>
      setMgmtState((prev) => ({
        ...prev,
        driverOptions: [...prev.driverOptions, { key: "", value: "" }]
      })),
    remove: (index: number) =>
      setMgmtState((prev) => ({
        ...prev,
        driverOptions: prev.driverOptions.filter((_, i) => i !== index)
      })),
    update: (index: number, field: "key" | "value", value: string) =>
      setMgmtState((prev) => ({
        ...prev,
        driverOptions: prev.driverOptions.map((opt, i) =>
          i === index ? { ...opt, [field]: value } : opt
        )
      })),
    setAll: (options: DriverOption[]) =>
      setMgmtState((prev) => ({ ...prev, driverOptions: options }))
  };

  const handleSave = useCallback(async () => {
    const payload = buildLabSettingsUpdate(labSettings, basic, mgmt);
    if (!payload) return;
    await executeTopologyCommand({ command: "setLabSettings", payload }, {}, sessionClient);
  }, [labSettings, basic, mgmt, sessionClient]);

  return {
    basic,
    mgmt,
    setBasic,
    setMgmt,
    driverOpts,
    handleSave
  };
}
