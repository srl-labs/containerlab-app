/**
 * Types for Lab Settings Panel
 */
import type { LabSettings as SharedLabSettings } from "../../../core/types/labSettings";

export type LabSettings = SharedLabSettings;

export type PrefixType = "default" | "custom" | "no-prefix";
export type IpType = "default" | "auto" | "custom";

export interface DriverOption {
  key: string;
  value: string;
}

export interface BasicSettingsState {
  labName: string;
  prefixType: PrefixType;
  customPrefix: string;
}

export interface MgmtSettingsState {
  networkName: string;
  ipv4Type: IpType;
  ipv4Subnet: string;
  ipv4Gateway: string;
  ipv4Range: string;
  ipv6Type: IpType;
  ipv6Subnet: string;
  ipv6Gateway: string;
  mtu: string;
  bridge: string;
  externalAccess: boolean;
  driverOptions: DriverOption[];
}

/** Grouped setters for the Basic tab (matches useLabSettingsState().setBasic) */
export interface BasicSettingsSetters {
  setLabName: (v: string) => void;
  setPrefixType: (v: PrefixType) => void;
  setCustomPrefix: (v: string) => void;
}

/** Grouped setters for the Management tab (matches useLabSettingsState().setMgmt) */
export interface MgmtSettingsSetters {
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
}

/** Driver-option list actions needed by the Management tab */
export interface DriverOptionsActions {
  add: () => void;
  setAll: (options: DriverOption[]) => void;
}
