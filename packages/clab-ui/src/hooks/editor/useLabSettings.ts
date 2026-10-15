/**
 * Hook for managing Lab Settings state (host-authoritative).
 */
import { useState, useCallback, useEffect, useMemo } from "react";

import type {
  LabSettings,
  PrefixType,
  IpType,
  DriverOption,
  BasicSettingsState,
  IpamProvider,
  MacvlanMode,
  MgmtDriver,
  MgmtFormState,
  MgmtNetworkFormState,
  MgmtSettingsSetters,
  MgmtSettingsState
} from "../../components/panels/lab-settings/types";
import { useTopologySessionClient } from "../../host";
import { executeTopologyCommand } from "../../services";

import {
  buildInitialBasic,
  buildInitialMgmt,
  buildLabSettingsUpdate,
  createMgmtNetworkForm,
  hasMgmtNetworkIssues,
  validateMgmtNetworks,
  type MgmtNetworkIssues
} from "./labSettingsForm";

export interface MgmtNetworkListActions {
  networks: MgmtNetworkFormState[];
  /** Index of the network the form below the list edits */
  selected: number;
  select: (index: number) => void;
  add: () => void;
  remove: (index: number) => void;
  move: (index: number, offset: -1 | 1) => void;
  defaultMgmtNet: string;
  setDefaultMgmtNet: (value: string) => void;
  issues: MgmtNetworkIssues[];
}

export interface UseLabSettingsStateResult {
  basic: BasicSettingsState;
  /** The selected management network */
  mgmt: MgmtSettingsState;
  mgmtNetworks: MgmtNetworkListActions;
  setBasic: {
    setLabName: (v: string) => void;
    setPrefixType: (v: PrefixType) => void;
    setCustomPrefix: (v: string) => void;
  };
  setMgmt: MgmtSettingsSetters;
  driverOpts: {
    add: () => void;
    remove: (index: number) => void;
    update: (index: number, field: "key" | "value", value: string) => void;
    setAll: (options: DriverOption[]) => void;
  };
  /** False while the management networks have problems containerlab would reject */
  isValid: boolean;
  handleSave: () => Promise<void>;
}

/** Next free `mgmtN` name for a new network */
function nextNetworkName(networks: MgmtNetworkFormState[]): string {
  const names = new Set(networks.map((network) => network.networkName.trim()));
  let index = networks.length + 1;
  while (names.has(`mgmt${index}`)) index += 1;
  return `mgmt${index}`;
}

export function useLabSettingsState(labSettings?: LabSettings): UseLabSettingsStateResult {
  const sessionClient = useTopologySessionClient();
  const [basic, setBasicState] = useState<BasicSettingsState>(() => buildInitialBasic(labSettings));
  const [mgmtForm, setMgmtForm] = useState<MgmtFormState>(() => buildInitialMgmt(labSettings));
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    setBasicState(buildInitialBasic(labSettings));
    setMgmtForm(buildInitialMgmt(labSettings));
    setSelected(0);
  }, [labSettings]);

  const selectedIndex = Math.min(selected, mgmtForm.networks.length - 1);
  const mgmt = mgmtForm.networks[selectedIndex];

  const setBasic = {
    setLabName: (v: string) => setBasicState((prev) => ({ ...prev, labName: v })),
    setPrefixType: (v: PrefixType) => setBasicState((prev) => ({ ...prev, prefixType: v })),
    setCustomPrefix: (v: string) => setBasicState((prev) => ({ ...prev, customPrefix: v }))
  };

  const updateSelected = (patch: (network: MgmtNetworkFormState) => MgmtNetworkFormState) =>
    setMgmtForm((prev) => ({
      ...prev,
      networks: prev.networks.map((network, index) =>
        index === selectedIndex ? patch(network) : network
      )
    }));
  const setField = <K extends keyof MgmtSettingsState>(key: K, value: MgmtSettingsState[K]) =>
    updateSelected((network) => ({ ...network, [key]: value }));

  const setMgmt: MgmtSettingsSetters = {
    // The node default follows a rename of the network it points at.
    setNetworkName: (v: string) =>
      setMgmtForm((prev) => {
        const current = prev.networks[selectedIndex];
        const followsRename =
          prev.defaultMgmtNet !== "" && prev.defaultMgmtNet === current.networkName.trim();
        return {
          defaultMgmtNet: followsRename ? v.trim() : prev.defaultMgmtNet,
          networks: prev.networks.map((network, index) =>
            index === selectedIndex ? { ...network, networkName: v } : network
          )
        };
      }),
    // Macvlan networks take an explicit subnet or the parent's, never `auto`.
    setDriver: (v: MgmtDriver) =>
      updateSelected((network) => ({
        ...network,
        driver: v,
        ...(v === "macvlan"
          ? {
              ipv4Type: network.ipv4Type === "auto" ? "default" : network.ipv4Type,
              ipv6Type: network.ipv6Type === "auto" ? "default" : network.ipv6Type
            }
          : {})
      })),
    setMacvlanParent: (v: string) => setField("macvlanParent", v),
    setMacvlanMode: (v: MacvlanMode) => setField("macvlanMode", v),
    setMacvlanAux: (v: boolean) => setField("macvlanAux", v),
    setIpv4Type: (v: IpType) => setField("ipv4Type", v),
    setIpv4Subnet: (v: string) => setField("ipv4Subnet", v),
    setIpv4Gateway: (v: string) => setField("ipv4Gateway", v),
    setIpv4Range: (v: string) => setField("ipv4Range", v),
    setIpv6Type: (v: IpType) => setField("ipv6Type", v),
    setIpv6Subnet: (v: string) => setField("ipv6Subnet", v),
    setIpv6Gateway: (v: string) => setField("ipv6Gateway", v),
    setIpv6Range: (v: string) => setField("ipv6Range", v),
    setMtu: (v: string) => setField("mtu", v),
    setBridge: (v: string) => setField("bridge", v),
    setExternalAccess: (v: boolean) => setField("externalAccess", v),
    setIpamProvider: (v: IpamProvider) => setField("ipamProvider", v),
    setIpamDad: (v: boolean) => setField("ipamDad", v),
    setSkipWhenUnused: (v: boolean) => setField("skipWhenUnused", v)
  };

  const driverOpts = {
    add: () =>
      updateSelected((prev) => ({
        ...prev,
        driverOptions: [...prev.driverOptions, { key: "", value: "" }]
      })),
    remove: (index: number) =>
      updateSelected((prev) => ({
        ...prev,
        driverOptions: prev.driverOptions.filter((_, i) => i !== index)
      })),
    update: (index: number, field: "key" | "value", value: string) =>
      updateSelected((prev) => ({
        ...prev,
        driverOptions: prev.driverOptions.map((opt, i) =>
          i === index ? { ...opt, [field]: value } : opt
        )
      })),
    setAll: (options: DriverOption[]) =>
      updateSelected((prev) => ({ ...prev, driverOptions: options }))
  };

  const issues = useMemo(() => validateMgmtNetworks(mgmtForm), [mgmtForm]);

  const mgmtNetworks: MgmtNetworkListActions = {
    networks: mgmtForm.networks,
    selected: selectedIndex,
    select: setSelected,
    add: () => {
      setMgmtForm((prev) => {
        // The first network needs a name too once there are two.
        const named = prev.networks.map((network, index) =>
          index === 0 && prev.networks.length === 1 && network.networkName.trim() === ""
            ? { ...network, networkName: "clab" }
            : network
        );
        return {
          ...prev,
          networks: [...named, createMgmtNetworkForm(nextNetworkName(named))]
        };
      });
      setSelected(mgmtForm.networks.length);
    },
    remove: (index: number) => {
      setMgmtForm((prev) => {
        if (prev.networks.length <= 1) return prev;
        const removedName = prev.networks[index]?.networkName.trim();
        return {
          defaultMgmtNet: prev.defaultMgmtNet === removedName ? "" : prev.defaultMgmtNet,
          networks: prev.networks.filter((_, i) => i !== index)
        };
      });
      setSelected((prev) => (prev > index || prev === mgmtForm.networks.length - 1 ? prev - 1 : prev));
    },
    move: (index: number, offset: -1 | 1) => {
      const target = index + offset;
      if (target < 0 || target >= mgmtForm.networks.length) return;
      setMgmtForm((prev) => {
        const networks = [...prev.networks];
        [networks[index], networks[target]] = [networks[target], networks[index]];
        return { ...prev, networks };
      });
      setSelected(target);
    },
    defaultMgmtNet: mgmtForm.defaultMgmtNet,
    setDefaultMgmtNet: (value: string) =>
      setMgmtForm((prev) => ({ ...prev, defaultMgmtNet: value })),
    issues
  };

  const isValid = !hasMgmtNetworkIssues(issues);

  const handleSave = useCallback(async () => {
    const payload = buildLabSettingsUpdate(labSettings, basic, mgmtForm);
    if (!payload) return;
    await executeTopologyCommand({ command: "setLabSettings", payload }, {}, sessionClient);
  }, [labSettings, basic, mgmtForm, sessionClient]);

  return {
    basic,
    mgmt,
    mgmtNetworks,
    setBasic,
    setMgmt,
    driverOpts,
    isValid,
    handleSave
  };
}
