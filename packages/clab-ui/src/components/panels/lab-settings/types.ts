/**
 * Types for Lab Settings Panel
 */
import type { LabSettings as SharedLabSettings } from "../../../core/types/labSettings";

export type LabSettings = SharedLabSettings;

export type PrefixType = "default" | "custom" | "no-prefix";
export type IpType = "default" | "auto" | "custom";
export type MgmtDriver = "bridge" | "macvlan";
export type MacvlanMode = "bridge" | "private" | "vepa" | "passthru";
export type IpamProvider = "containerlab" | "runtime";
/** `off`, `sidecar` (auth-key, every node joins) or `proxy` (SSO, the lab joins as one device) */
export type TailscaleMode = "off" | "sidecar" | "proxy";
/** `generated` by containerlab, or `external` cert and key files */
export type CaMode = "generated" | "external";

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
  driver: MgmtDriver;
  macvlanParent: string;
  macvlanMode: MacvlanMode;
  /** Auxiliary macvlan interface giving the host access to the nodes */
  macvlanAux: boolean;
  ipv4Type: IpType;
  ipv4Subnet: string;
  ipv4Gateway: string;
  ipv4Range: string;
  ipv6Type: IpType;
  ipv6Subnet: string;
  ipv6Gateway: string;
  ipv6Range: string;
  mtu: string;
  bridge: string;
  externalAccess: boolean;
  ipamProvider: IpamProvider;
  /** Duplicate address detection */
  ipamDad: boolean;
  skipWhenUnused: boolean;
  tailscaleMode: TailscaleMode;
  tailscaleAuthKey: string;
  driverOptions: DriverOption[];
}

/** One management network in the form. */
export interface MgmtNetworkFormState extends MgmtSettingsState {
  /** Stable key while networks are added, removed and reordered */
  id: string;
  /** Index of the network in the file it was loaded from; absent for a new network */
  source?: number;
}

/** The Management tab: networks in order (first = default) and the node default. */
export interface MgmtFormState {
  networks: MgmtNetworkFormState[];
  /** `topology.defaults.mgmt-net`; empty when nodes pick their own */
  defaultMgmtNet: string;
}

/** The Certificates tab: `settings.certificate-authority` */
export interface CertificateAuthorityState {
  mode: CaMode;
  cert: string;
  key: string;
  keySize: string;
  validityDuration: string;
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
  setDriver: (v: MgmtDriver) => void;
  setMacvlanParent: (v: string) => void;
  setMacvlanMode: (v: MacvlanMode) => void;
  setMacvlanAux: (v: boolean) => void;
  setIpv4Type: (v: IpType) => void;
  setIpv4Subnet: (v: string) => void;
  setIpv4Gateway: (v: string) => void;
  setIpv4Range: (v: string) => void;
  setIpv6Type: (v: IpType) => void;
  setIpv6Subnet: (v: string) => void;
  setIpv6Gateway: (v: string) => void;
  setIpv6Range: (v: string) => void;
  setMtu: (v: string) => void;
  setBridge: (v: string) => void;
  setExternalAccess: (v: boolean) => void;
  setIpamProvider: (v: IpamProvider) => void;
  setIpamDad: (v: boolean) => void;
  setSkipWhenUnused: (v: boolean) => void;
  setTailscaleMode: (v: TailscaleMode) => void;
  setTailscaleAuthKey: (v: string) => void;
}

/** Driver-option list actions needed by the Management tab */
export interface DriverOptionsActions {
  add: () => void;
  setAll: (options: DriverOption[]) => void;
}
